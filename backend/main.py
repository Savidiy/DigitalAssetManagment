from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import tempfile
import uuid
from pathlib import Path
from typing import Any
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mkv"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
DEFAULT_TAGS = {"version": 1, "groups": [], "tags": []}
APP_ROOT = Path(__file__).parent.parent
ERROR_LOG_PATH = APP_ROOT / "logs" / "errors.log"


class TagsUpdate(BaseModel):
    tags: list[str] = Field(default_factory=list)


class CommentUpdate(BaseModel):
    comment: str = ""


class DetailsUpdate(BaseModel):
    comment: str = ""
    link: str = ""


class TagCreate(BaseModel):
    id: str | None = None
    name: str
    groups: list[str] = Field(default_factory=list)
    color: str | None = None
    icon: str | None = None


class TagUpdate(BaseModel):
    name: str
    groups: list[str] = Field(default_factory=list)
    color: str | None = None
    icon: str | None = None


class TagMerge(BaseModel):
    targetTagId: str


class GroupCreate(BaseModel):
    id: str | None = None
    name: str
    parentId: str | None = None


class GroupUpdate(BaseModel):
    name: str
    parentId: str | None = None


class TaxonomyOrderUpdate(BaseModel):
    groupIds: list[str]
    tagIds: list[str]


class LibraryState:
    root: Path | None = None
    assets: dict[str, dict[str, Any]] = {}
    tags: dict[str, Any] = DEFAULT_TAGS.copy()
    library_errors: list[str] = []


state = LibraryState()
asset_write_lock = threading.RLock()
app = FastAPI(title="Reference Library")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

error_logger = logging.getLogger("reference_library.errors")
error_logger.setLevel(logging.ERROR)
error_logger.propagate = False
if not error_logger.handlers:
    try:
        ERROR_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(ERROR_LOG_PATH, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        error_logger.addHandler(handler)
    except OSError:
        # A read-only installation must not prevent the local server from starting.
        pass


@app.middleware("http")
async def log_unhandled_errors(request: Request, call_next: Any) -> Any:
    try:
        return await call_next(request)
    except Exception:
        error_logger.exception("Unhandled error during %s %s", request.method, request.url.path)
        raise


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def app_settings_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".reference-library"))
    return base / "ReferenceLibrary" / "settings.json"


def save_last_library(root: Path) -> None:
    atomic_json_write(app_settings_path(), {"version": 1, "lastLibraryPath": str(root)})


def last_library_path() -> Path | None:
    try:
        path = read_json(app_settings_path()).get("lastLibraryPath")
        return Path(path) if isinstance(path, str) else None
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def library_paths(root: Path) -> tuple[Path, Path]:
    folder = root / ".library"
    return folder / "config.json", folder / "tags.json"


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def valid_tags(data: Any) -> bool:
    return isinstance(data, dict) and data.get("version") == 1 and isinstance(data.get("groups"), list) and isinstance(data.get("tags"), list)


def validate_tag_presentation(color: str | None, icon: str | None) -> tuple[str | None, str | None]:
    normalized_color = color.strip() if color else None
    normalized_icon = icon.strip() if icon else None
    if normalized_color and not re.fullmatch(r"#[0-9a-fA-F]{6}", normalized_color):
        raise HTTPException(400, "Color must be a #RRGGBB value")
    if normalized_icon and len(normalized_icon) > 12:
        raise HTTPException(400, "Icon must be at most 12 characters")
    return normalized_color, normalized_icon


def tag_name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def require_library() -> Path:
    if state.root is None:
        raise HTTPException(409, "Library is not open")
    return state.root


def public_asset(asset: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in asset.items() if key != "path"}


def find_asset(asset_id: str) -> dict[str, Any] | None:
    """Find an asset by current ID or stable runtime ID during an in-flight save."""
    return state.assets.get(asset_id) or next((asset for asset in state.assets.values() if asset["runtimeId"] == asset_id), None)


def persist_asset(asset_id: str, *, tags: list[str] | None = None, comment: str | None = None, link: str | None = None) -> dict[str, Any]:
    """Atomically write one asset's metadata and return the refreshed asset."""
    with asset_write_lock:
        root = require_library()
        asset = find_asset(asset_id)
        if not asset or any(error.startswith("Duplicate UUID") for error in asset["errors"]):
            raise HTTPException(404, "Asset unavailable for editing")
        new_id = asset["id"] if not asset["id"].startswith("runtime-") else str(uuid.uuid4())
        metadata = {
            "version": 1,
            "id": new_id,
            "tags": asset["tags"] if tags is None else tags,
            "comment": asset["comment"] if comment is None else comment,
            "link": asset["link"] if link is None else link,
        }
        atomic_json_write(Path(f"{asset['path']}.meta.json"), metadata)
        scan_library(root)
        return public_asset(state.assets[new_id])


def is_animated_gif(path: Path) -> bool:
    if path.suffix.lower() != ".gif":
        return False
    try:
        with Image.open(path) as image:
            return bool(getattr(image, "is_animated", False) and image.n_frames > 1)
    except (OSError, ValueError):
        return False


def scan_library(root: Path) -> None:
    _, tags_path = library_paths(root)
    try:
        tags = read_json(tags_path)
        if not valid_tags(tags):
            raise ValueError("unsupported tags format")
        tag_ids = {item.get("id") for item in tags["tags"] if isinstance(item, dict)}
    except (OSError, ValueError, json.JSONDecodeError) as error:
        tags, tag_ids = DEFAULT_TAGS.copy(), set()
        tags_error = f"tags.json: {error}"
    else:
        tags_error = None

    assets: dict[str, dict[str, Any]] = {}
    library_errors: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or ".library" in path.relative_to(root).parts or path.suffix.lower() not in MEDIA_EXTENSIONS:
            continue
        relative = path.relative_to(root).as_posix()
        runtime_id = "runtime-" + hashlib.sha256(relative.encode()).hexdigest()[:20]
        asset_id, tags_for_asset, comment, link, errors = runtime_id, [], "", "", []
        meta_path = Path(f"{path}.meta.json")
        if meta_path.exists():
            try:
                metadata = read_json(meta_path)
                if not isinstance(metadata, dict) or metadata.get("version") != 1:
                    errors.append("Unsupported metadata version")
                elif not isinstance(metadata.get("id"), str) or not isinstance(metadata.get("tags"), list) or ("comment" in metadata and not isinstance(metadata["comment"], str)) or ("link" in metadata and not isinstance(metadata["link"], str)):
                    errors.append("Invalid metadata structure")
                else:
                    asset_id = metadata["id"]
                    tags_for_asset = [tag for tag in metadata["tags"] if isinstance(tag, str)]
                    comment = metadata.get("comment", "")
                    link = metadata.get("link", "")
                    unknown = [tag for tag in tags_for_asset if tag not in tag_ids]
                    if unknown:
                        errors.append("Unknown tag ID: " + ", ".join(unknown))
            except json.JSONDecodeError:
                errors.append("Invalid JSON in metadata")
            except OSError as error:
                errors.append(f"Cannot read metadata: {error}")
        asset_key = asset_id
        if asset_id in assets:
            assets[asset_id]["errors"].append(f"Duplicate UUID: {asset_id}")
            errors.append(f"Duplicate UUID: {asset_id}")
            asset_key = runtime_id
        assets[asset_key] = {
            "id": asset_key, "runtimeId": runtime_id, "relativePath": relative, "name": path.name,
            "kind": "image" if path.suffix.lower() in IMAGE_EXTENSIONS else "video", "tags": tags_for_asset,
            "isAnimatedGif": is_animated_gif(path), "addedAt": path.stat().st_ctime,
            "comment": comment, "link": link, "untagged": not tags_for_asset, "errors": errors, "path": path,
        }
    for sidecar in root.rglob("*.meta.json"):
        if ".library" in sidecar.relative_to(root).parts:
            continue
        media_path = Path(str(sidecar)[:-len(".meta.json")])
        if not media_path.exists():
            library_errors.append(f"Orphan sidecar: {sidecar.relative_to(root).as_posix()}")
    state.root, state.assets, state.tags, state.library_errors = root, assets, tags, library_errors
    if tags_error:
        # Surface library-level corruption once per asset list instead of failing the scan.
        for asset in state.assets.values():
            asset["errors"].append(tags_error)


def open_library(path: str) -> dict[str, Any]:
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(400, "Selected path is not a folder")
    config_path, tags_path = library_paths(root)
    if not config_path.exists() or not tags_path.exists():
        return {"open": True, "path": str(root), "initialized": False}
    try:
        config = read_json(config_path)
        if not isinstance(config, dict) or config.get("version") != 1:
            raise ValueError("Unsupported config version")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(400, f"Invalid .library/config.json: {error}")
    scan_library(root)
    save_last_library(root)
    return {"path": str(root), "initialized": True, "name": config.get("name", root.name)}


@app.get("/api/library")
def get_library() -> dict[str, Any]:
    if state.root is None:
        remembered = last_library_path()
        try:
            if remembered and remembered.is_dir():
                open_library(str(remembered))
        except (HTTPException, OSError):
            # A disconnected network/cloud drive must not prevent the app from opening.
            pass
        if state.root is None:
            return {"open": False}
    config_path, _ = library_paths(state.root)
    config = read_json(config_path)
    return {"open": True, "path": str(state.root), "name": config.get("name", state.root.name), "errors": state.library_errors}


@app.post("/api/library/select")
def select_library() -> dict[str, Any]:
    try:
        import tkinter as tk
        from tkinter import filedialog
        window = tk.Tk()
        window.withdraw()
        window.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Choose Reference Library folder")
        window.destroy()
    except Exception as error:
        raise HTTPException(500, f"Could not open folder picker: {error}")
    if not selected:
        return {"cancelled": True}
    return open_library(selected)


class Initialize(BaseModel):
    path: str
    name: str | None = None


@app.post("/api/library/initialize")
def initialize_library(body: Initialize) -> dict[str, Any]:
    root = Path(body.path).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(400, "Selected path is not a folder")
    config_path, tags_path = library_paths(root)
    if config_path.exists() or tags_path.exists():
        raise HTTPException(409, "Library is already initialized")
    atomic_json_write(config_path, {"version": 1, "name": body.name or root.name})
    atomic_json_write(tags_path, DEFAULT_TAGS)
    return open_library(str(root))


@app.post("/api/library/rescan")
def rescan() -> dict[str, Any]:
    scan_library(require_library())
    return {"count": len(state.assets)}


@app.get("/api/assets")
def get_assets() -> list[dict[str, Any]]:
    require_library()
    return [public_asset(asset) for asset in sorted(state.assets.values(), key=lambda item: item["relativePath"].lower())]


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: str) -> dict[str, Any]:
    require_library()
    asset = state.assets.get(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    return public_asset(asset)


@app.put("/api/assets/{asset_id}/tags")
def update_asset_tags(asset_id: str, body: TagsUpdate) -> dict[str, Any]:
    asset = find_asset(asset_id)
    if not asset or any(error.startswith("Duplicate UUID") for error in asset["errors"]):
        raise HTTPException(404, "Asset unavailable for editing")
    available = {tag.get("id") for tag in state.tags["tags"] if isinstance(tag, dict)}
    if len(body.tags) != len(set(body.tags)) or not set(body.tags).issubset(available):
        raise HTTPException(400, "Tags must be unique known tag IDs")
    return persist_asset(asset_id, tags=body.tags)


@app.put("/api/assets/{asset_id}/comment")
def update_asset_comment(asset_id: str, body: CommentUpdate) -> dict[str, Any]:
    asset = find_asset(asset_id)
    if not asset or any(error.startswith("Duplicate UUID") for error in asset["errors"]):
        raise HTTPException(404, "Asset unavailable for editing")
    if len(body.comment) > 10_000:
        raise HTTPException(400, "Comment is too long")
    return persist_asset(asset_id, comment=body.comment)


@app.put("/api/assets/{asset_id}/details")
def update_asset_details(asset_id: str, body: DetailsUpdate) -> dict[str, Any]:
    asset = find_asset(asset_id)
    if not asset or any(error.startswith("Duplicate UUID") for error in asset["errors"]):
        raise HTTPException(404, "Asset unavailable for editing")
    if len(body.comment) > 10_000:
        raise HTTPException(400, "Comment is too long")
    link = body.link.strip()
    if len(link) > 2_000:
        raise HTTPException(400, "Link is too long")
    if link and not link.lower().startswith(("https://", "http://")):
        raise HTTPException(400, "Link must start with http:// or https://")
    return persist_asset(asset_id, comment=body.comment, link=link)


@app.get("/api/tags")
def get_tags() -> dict[str, Any]:
    require_library()
    return state.tags


@app.post("/api/tags")
def create_tag(body: TagCreate) -> dict[str, Any]:
    root = require_library()
    tag_id = body.id or uuid.uuid4().hex
    if any(tag.get("id") == tag_id for tag in state.tags["tags"]):
        raise HTTPException(409, "Tag ID already exists")
    if any(tag_name_key(str(tag.get("name", ""))) == tag_name_key(body.name) for tag in state.tags["tags"]):
        raise HTTPException(409, "A tag with this name already exists")
    groups = {group.get("id") for group in state.tags["groups"]}
    if not set(body.groups).issubset(groups):
        raise HTTPException(400, "Unknown group ID")
    color, icon = validate_tag_presentation(body.color, body.icon)
    tag = {"id": tag_id, "name": body.name.strip(), "groups": body.groups, "color": color, "icon": icon}
    if not tag["name"]:
        raise HTTPException(400, "Tag name is required")
    state.tags["tags"].append(tag)
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return tag


@app.put("/api/tags/{tag_id}")
def update_tag(tag_id: str, body: TagUpdate) -> dict[str, Any]:
    root = require_library()
    tag = next((item for item in state.tags["tags"] if item.get("id") == tag_id), None)
    if tag is None:
        raise HTTPException(404, "Tag not found")
    if any(item.get("id") != tag_id and tag_name_key(str(item.get("name", ""))) == tag_name_key(body.name) for item in state.tags["tags"]):
        raise HTTPException(409, "A tag with this name already exists; merge it instead")
    group_ids = {group.get("id") for group in state.tags["groups"]}
    if not body.name.strip() or not set(body.groups).issubset(group_ids):
        raise HTTPException(400, "Tag name and group IDs are invalid")
    color, icon = validate_tag_presentation(body.color, body.icon)
    tag.update(name=body.name.strip(), groups=body.groups, color=color, icon=icon)
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return tag


@app.post("/api/tags/{tag_id}/merge")
def merge_tag(tag_id: str, body: TagMerge) -> dict[str, str]:
    root = require_library()
    source = next((item for item in state.tags["tags"] if item.get("id") == tag_id), None)
    target = next((item for item in state.tags["tags"] if item.get("id") == body.targetTagId), None)
    if source is None or target is None or source is target:
        raise HTTPException(400, "Choose two different existing tags")
    affected = [asset for asset in state.assets.values() if tag_id in asset["tags"]]
    if any(any(error.startswith("Duplicate UUID") for error in asset["errors"]) for asset in affected):
        raise HTTPException(409, "Resolve duplicate UUID metadata before merging")
    try:
        for asset in affected:
            merged_tags = list(dict.fromkeys(body.targetTagId if value == tag_id else value for value in asset["tags"]))
            metadata = {"version": 1, "id": asset["id"], "tags": merged_tags, "comment": asset["comment"], "link": asset["link"]}
            atomic_json_write(Path(f"{asset['path']}.meta.json"), metadata)
        state.tags["tags"] = [item for item in state.tags["tags"] if item.get("id") != tag_id]
        _, tags_path = library_paths(root)
        atomic_json_write(tags_path, state.tags)
    except OSError as error:
        raise HTTPException(500, f"Could not merge tags: {error}")
    scan_library(root)
    return {"targetTagId": body.targetTagId}


@app.post("/api/tag-groups")
def create_group(body: GroupCreate) -> dict[str, Any]:
    root = require_library()
    group_id = body.id or uuid.uuid4().hex
    if any(group.get("id") == group_id for group in state.tags["groups"]):
        raise HTTPException(409, "Group ID already exists")
    existing_ids = {item.get("id") for item in state.tags["groups"]}
    if body.parentId is not None and body.parentId not in existing_ids:
        raise HTTPException(400, "Parent group not found")
    group = {"id": group_id, "name": body.name.strip(), "parentId": body.parentId}
    if not group["name"]:
        raise HTTPException(400, "Group name is required")
    state.tags["groups"].append(group)
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return group


@app.put("/api/tag-groups/{group_id}")
def update_group(group_id: str, body: GroupUpdate) -> dict[str, Any]:
    root = require_library()
    group = next((item for item in state.tags["groups"] if item.get("id") == group_id), None)
    if group is None:
        raise HTTPException(404, "Group not found")
    if not body.name.strip():
        raise HTTPException(400, "Group name is required")
    group_ids = {item.get("id") for item in state.tags["groups"]}
    if body.parentId is not None and body.parentId not in group_ids:
        raise HTTPException(400, "Parent group not found")
    if body.parentId == group_id:
        raise HTTPException(400, "A group cannot be its own parent")
    parent_id = body.parentId
    while parent_id is not None:
        if parent_id == group_id:
            raise HTTPException(400, "A group cannot be moved into its descendant")
        parent = next((item for item in state.tags["groups"] if item.get("id") == parent_id), None)
        parent_id = parent.get("parentId") if parent else None
    group.update(name=body.name.strip(), parentId=body.parentId)
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return group


@app.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: str) -> dict[str, bool]:
    root = require_library()
    tag = next((item for item in state.tags["tags"] if item.get("id") == tag_id), None)
    if tag is None:
        raise HTTPException(404, "Tag not found")
    used_by = [asset["relativePath"] for asset in state.assets.values() if tag_id in asset["tags"]]
    if used_by:
        raise HTTPException(409, f"Tag is used by {len(used_by)} assets; remove it from those assets first")
    state.tags["tags"] = [item for item in state.tags["tags"] if item.get("id") != tag_id]
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return {"deleted": True}


@app.delete("/api/tag-groups/{group_id}")
def delete_group(group_id: str) -> dict[str, bool]:
    root = require_library()
    group = next((item for item in state.tags["groups"] if item.get("id") == group_id), None)
    if group is None:
        raise HTTPException(404, "Folder not found")
    if any(item.get("parentId") == group_id for item in state.tags["groups"]):
        raise HTTPException(409, "Move or delete child folders first")
    if any(group_id in tag.get("groups", []) for tag in state.tags["tags"]):
        raise HTTPException(409, "Remove this folder from its tags first")
    state.tags["groups"] = [item for item in state.tags["groups"] if item.get("id") != group_id]
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return {"deleted": True}


@app.put("/api/taxonomy/order")
def update_taxonomy_order(body: TaxonomyOrderUpdate) -> dict[str, bool]:
    root = require_library()
    groups_by_id = {group.get("id"): group for group in state.tags["groups"]}
    tags_by_id = {tag.get("id"): tag for tag in state.tags["tags"]}
    if len(body.groupIds) != len(set(body.groupIds)) or set(body.groupIds) != set(groups_by_id):
        raise HTTPException(400, "Group order must contain every group exactly once")
    if len(body.tagIds) != len(set(body.tagIds)) or set(body.tagIds) != set(tags_by_id):
        raise HTTPException(400, "Tag order must contain every tag exactly once")
    state.tags["groups"] = [groups_by_id[group_id] for group_id in body.groupIds]
    state.tags["tags"] = [tags_by_id[tag_id] for tag_id in body.tagIds]
    _, tags_path = library_paths(root)
    atomic_json_write(tags_path, state.tags)
    return {"saved": True}


@app.get("/api/media/{asset_id}")
def media(asset_id: str):
    require_library()
    asset = state.assets.get(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    return FileResponse(asset["path"])


def thumbnail_path(asset_id: str) -> Path:
    root = require_library()
    cache_id = hashlib.sha256(str(root).encode()).hexdigest()[:16]
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".reference-library"))
    return base / "ReferenceLibrary" / "cache" / cache_id / "thumbnails" / f"{asset_id}.jpg"


@app.get("/api/thumbnails/{asset_id}")
def thumbnail(asset_id: str):
    asset = state.assets.get(asset_id)
    if not asset or asset["kind"] != "video":
        raise HTTPException(404, "Video not found")
    output = thumbnail_path(asset_id)
    if not output.exists():
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise HTTPException(404, "ffmpeg is not available")
        output.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run([ffmpeg, "-y", "-ss", "00:00:01", "-i", str(asset["path"]), "-frames:v", "1", "-vf", "scale=480:-2", str(output)], capture_output=True, timeout=45)
        if result.returncode != 0 or not output.exists():
            output.unlink(missing_ok=True)
            raise HTTPException(422, "Could not create video thumbnail")
    return FileResponse(output, media_type="image/jpeg")


@app.post("/api/shutdown")
def shutdown() -> dict[str, bool]:
    """Stop this local-only process after the response reaches the browser."""
    def stop_process() -> None:
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=stop_process, daemon=True).start()
    return {"stopping": True}


frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
