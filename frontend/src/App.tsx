import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type Tag = { id: string; name: string; groups: string[]; color?: string | null; icon?: string | null };
type Group = { id: string; name: string; parentId?: string | null };
type Asset = { id: string; runtimeId: string; name: string; relativePath: string; kind: 'image' | 'video'; isAnimatedGif: boolean; addedAt: number; comment: string; link: string; tags: string[]; untagged: boolean; errors: string[] };
type Library = { open?: boolean; path?: string; name?: string; initialized?: boolean; cancelled?: boolean; errors?: string[] };
type UiSettings = { selectedAssetId?: string | null; selectedTags?: string[]; includedGroups?: string[]; missingGroups?: string[]; untagged?: boolean; mediaKinds?: Asset['kind'][]; animatedGifs?: boolean; sortBy?: 'name' | 'addedAt'; sortDirection?: 'asc' | 'desc'; search?: string; cardSize?: number; detailsWidth?: number; videoVolume?: number };
const api = '/api';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${url}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) throw new Error((await response.text()).replace(/^\{"detail":"?/, '').replace(/"?\}$/, ''));
  return response.json();
}

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [includedGroups, setIncludedGroups] = useState<string[]>([]);
  const [missingGroups, setMissingGroups] = useState<string[]>([]);
  const [untagged, setUntagged] = useState(false);
  const [mediaKinds, setMediaKinds] = useState<Asset['kind'][]>([]);
  const [animatedGifs, setAnimatedGifs] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'addedAt'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [pendingPath, setPendingPath] = useState('');
  const [notice, setNotice] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<Tag, 'id'> & { id?: string }>({ name: '', groups: [], color: '#7c5cff', icon: '' });
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupParent, setNewGroupParent] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [cardSize, setCardSize] = useState(160);
  const [detailsWidth, setDetailsWidth] = useState(350);
  const [resizeStart, setResizeStart] = useState<{ x: number; width: number } | null>(null);
  const [stickyAssetId, setStickyAssetId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [managerTagSearch, setManagerTagSearch] = useState('');
  const [detailsDraft, setDetailsDraft] = useState({ comment: '', link: '' });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [assetCollapsedGroups, setAssetCollapsedGroups] = useState<string[]>([]);
  const [videoVolume, setVideoVolume] = useState(1);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragTagId, setDragTagId] = useState<string | null>(null);
  const restoredLibraryPath = useRef<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingAssetTags = useRef(new Map<string, string[]>());
  const tagSaveTimers = useRef(new Map<string, number>());
  const tagSavesInFlight = useRef(new Set<string>());
  const selectedRuntimeId = useRef<string | null>(null);
  const detailsSaveTimer = useRef<number | null>(null);
  const managerRef = useRef<HTMLElement | null>(null);

  const restoreUiSettings = (path: string) => {
    if (restoredLibraryPath.current === path) return;
    restoredLibraryPath.current = path;
    let saved: UiSettings = {};
    try { saved = JSON.parse(localStorage.getItem(`reference-library-ui:${path}`) || '{}') as UiSettings; } catch { /* Use defaults if local storage is malformed. */ }
    setSelected(typeof saved.selectedAssetId === 'string' ? saved.selectedAssetId : null);
    setSelectedTags(Array.isArray(saved.selectedTags) ? saved.selectedTags : []);
    setIncludedGroups(Array.isArray(saved.includedGroups) ? saved.includedGroups : []);
    setMissingGroups(Array.isArray(saved.missingGroups) ? saved.missingGroups : []);
    setUntagged(Boolean(saved.untagged));
    setMediaKinds(Array.isArray(saved.mediaKinds) ? saved.mediaKinds.filter(kind => kind === 'image' || kind === 'video') : []);
    setAnimatedGifs(Boolean(saved.animatedGifs));
    setSortBy(saved.sortBy === 'addedAt' ? 'addedAt' : 'name');
    setSortDirection(saved.sortDirection === 'desc' ? 'desc' : 'asc');
    setSearch(typeof saved.search === 'string' ? saved.search : '');
    setCardSize(typeof saved.cardSize === 'number' ? Math.max(110, Math.min(300, saved.cardSize)) : 160);
    setDetailsWidth(typeof saved.detailsWidth === 'number' ? Math.max(260, Math.min(700, saved.detailsWidth)) : 350);
    setVideoVolume(typeof saved.videoVolume === 'number' ? Math.max(0, Math.min(1, saved.videoVolume)) : 1);
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [libraryResult, assetResult, tagResult] = await Promise.all([request<Library>('/library'), request<Asset[]>('/assets'), request<{groups: Group[]; tags: Tag[]}>('/tags')]);
      restoreUiSettings(libraryResult.path || 'default');
      setLibrary(libraryResult); setAssets(assetResult); setGroups(tagResult.groups); setTags(tagResult.tags);
    } finally { setLoading(false); }
  };
  useEffect(() => { request<Library>('/library').then(value => { setLibrary(value); if (value.open) reload(); }).catch(showError); }, []);
  const showError = (error: unknown) => setNotice(error instanceof Error ? error.message : 'Unexpected error');
  useEffect(() => {
    if (!library?.path || restoredLibraryPath.current !== library.path) return;
    const settings: UiSettings = { selectedAssetId: selected, selectedTags, includedGroups, missingGroups, untagged, mediaKinds, animatedGifs, sortBy, sortDirection, search, cardSize, detailsWidth, videoVolume };
    localStorage.setItem(`reference-library-ui:${library.path}`, JSON.stringify(settings));
  }, [library?.path, selected, selectedTags, includedGroups, missingGroups, untagged, mediaKinds, animatedGifs, sortBy, sortDirection, search, cardSize, detailsWidth, videoVolume]);

  const choose = async () => {
    try {
      const result = await request<Library>('/library/select', { method: 'POST' });
      if (result.cancelled) return;
      if (!result.initialized) { setPendingPath(result.path ?? ''); setLibrary(result); return; }
      await reload();
    } catch (error) { showError(error); }
  };
  const initialize = async () => {
    try { await request<Library>('/library/initialize', { method: 'POST', body: JSON.stringify({ path: pendingPath }) }); await reload(); }
    catch (error) { showError(error); }
  };
  const rescan = async () => { try { await request('/library/rescan', { method: 'POST' }); await reload(); } catch (error) { showError(error); } };
  // runtimeId is derived from the relative path and does not change when the first sidecar assigns a permanent UUID.
  const current = assets.find(asset => asset.runtimeId === selected || asset.id === selected) ?? null;
  useEffect(() => { selectedRuntimeId.current = current?.runtimeId || null; }, [current?.runtimeId]);
  useEffect(() => { setDetailsDraft({ comment: current?.comment || '', link: current?.link || '' }); }, [current?.runtimeId]);
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || current?.kind !== 'video') return;
    video.volume = videoVolume;
    const play = () => { void video.play().catch(() => { /* Browser autoplay policy may require pressing Play. */ }); };
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) play();
    else video.addEventListener('canplay', play, { once: true });
  }, [current?.runtimeId, videoVolume]);
  const tagById = new Map(tags.map(tag => [tag.id, tag]));
  const groupTree = (groupId: string): string[] => [groupId, ...groups.filter(group => group.parentId === groupId).flatMap(group => groupTree(group.id))];
  const tagSearchTerm = tagSearch.trim().toLowerCase();
  const managerTagSearchTerm = managerTagSearch.trim().toLowerCase();
  const groupMatchesTagSearch = (group: Group) => !tagSearchTerm || group.name.toLowerCase().includes(tagSearchTerm) || tags.some(tag => tag.name.toLowerCase().includes(tagSearchTerm) && tag.groups.some(id => groupTree(group.id).includes(id)));
  const visibleAssets = useMemo(() => assets.filter(asset => {
    const matchingTags = selectedTags.every(tag => asset.tags.includes(tag));
    const matchingInbox = !untagged || asset.untagged;
    const matchingKind = !mediaKinds.length || mediaKinds.includes(asset.kind);
    const matchingAnimation = !animatedGifs || asset.isAnimatedGif;
    const matchingIncludedFolders = includedGroups.every(groupId => {
      const folderIds = new Set(groupTree(groupId));
      return asset.tags.some(tagId => tagById.get(tagId)?.groups.some(id => folderIds.has(id)));
    });
    const matchingMissingFolders = missingGroups.every(groupId => {
      const folderIds = new Set(groupTree(groupId));
      return !asset.tags.some(tagId => tagById.get(tagId)?.groups.some(id => folderIds.has(id)));
    });
    const needle = search.trim().toLowerCase();
    return asset.runtimeId === stickyAssetId || asset.id === stickyAssetId || (matchingTags && matchingInbox && matchingKind && matchingAnimation && matchingIncludedFolders && matchingMissingFolders && (!needle || `${asset.relativePath} ${asset.comment}`.toLowerCase().includes(needle)));
  }).sort((left, right) => {
    const comparison = sortBy === 'name' ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) : left.addedAt - right.addedAt;
    return sortDirection === 'asc' ? comparison : -comparison;
  }), [assets, selectedTags, untagged, mediaKinds, animatedGifs, includedGroups, missingGroups, search, groups, tags, stickyAssetId, sortBy, sortDirection]);
  const toggleFilter = (tag: string) => setSelectedTags(currentTags => currentTags.includes(tag) ? currentTags.filter(item => item !== tag) : [...currentTags, tag]);
  const queueAssetTagSave = (runtimeId: string, delay = 300) => {
    const existingTimer = tagSaveTimers.current.get(runtimeId);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    tagSaveTimers.current.set(runtimeId, window.setTimeout(() => {
      tagSaveTimers.current.delete(runtimeId);
      void saveAssetTags(runtimeId);
    }, delay));
  };
  const saveAssetTags = async (runtimeId: string) => {
    if (tagSavesInFlight.current.has(runtimeId)) return;
    const next = pendingAssetTags.current.get(runtimeId);
    if (!next) return;
    pendingAssetTags.current.delete(runtimeId);
    tagSavesInFlight.current.add(runtimeId);
    try {
      const updated = await request<Asset>(`/assets/${encodeURIComponent(runtimeId)}/tags`, { method: 'PUT', body: JSON.stringify({ tags: next }) });
      const newerTags = pendingAssetTags.current.get(runtimeId);
      setAssets(items => items.map(item => item.runtimeId === runtimeId ? { ...updated, tags: newerTags || updated.tags, untagged: !(newerTags || updated.tags).length } : item));
      if (selectedRuntimeId.current === runtimeId) setSelected(runtimeId);
      setStickyAssetId(missingGroups.length ? runtimeId : null);
    } catch (error) {
      pendingAssetTags.current.delete(runtimeId);
      showError(error);
      await reload();
    } finally {
      tagSavesInFlight.current.delete(runtimeId);
      if (pendingAssetTags.current.has(runtimeId)) queueAssetTagSave(runtimeId, 0);
    }
  };
  const toggleAssetTag = (tagId: string) => {
    if (!current) return;
    const runtimeId = current.runtimeId;
    const base = pendingAssetTags.current.get(runtimeId) || current.tags;
    const next = base.includes(tagId) ? base.filter(id => id !== tagId) : [...base, tagId];
    pendingAssetTags.current.set(runtimeId, next);
    setAssets(items => items.map(item => item.runtimeId === runtimeId ? { ...item, tags: next, untagged: !next.length } : item));
    queueAssetTagSave(runtimeId);
  };
  const saveDetails = async (assetId: string, details: { comment: string; link: string }) => {
    try {
      const link = details.link.trim() && !/^https?:\/\//i.test(details.link.trim()) ? `https://${details.link.trim()}` : details.link.trim();
      const updated = await request<Asset>(`/assets/${encodeURIComponent(assetId)}/details`, { method: 'PUT', body: JSON.stringify({ comment: details.comment, link }) });
      setAssets(items => items.map(item => item.runtimeId === assetId ? updated : item));
      setSelected(assetId);
    } catch (error) { showError(error); }
  };
  const updateDetails = (field: 'comment' | 'link', value: string) => {
    if (!current) return;
    const next = { ...detailsDraft, [field]: value };
    setDetailsDraft(next);
    if (detailsSaveTimer.current !== null) window.clearTimeout(detailsSaveTimer.current);
    const assetId = current.runtimeId;
    detailsSaveTimer.current = window.setTimeout(() => { detailsSaveTimer.current = null; void saveDetails(assetId, next); }, 500);
  };
  const openNewTag = () => { setDraft({ name: '', groups: [], color: '#7c5cff', icon: '' }); setManagerOpen(true); };
  const editTag = (tag: Tag) => { setDraft({ ...tag, color: tag.color || '#7c5cff', icon: tag.icon || '' }); setManagerOpen(true); };
  const copyTag = (tag: Tag) => { setDraft({ name: tag.name, groups: [...tag.groups], color: tag.color || '#7c5cff', icon: tag.icon || '' }); setManagerOpen(true); };
  const mergeTags = async (sourceId: string, target: Tag) => {
    try {
      await request(`/tags/${encodeURIComponent(sourceId)}/merge`, { method: 'POST', body: JSON.stringify({ targetTagId: target.id }) });
      setDraft({ name: '', groups: [], color: '#7c5cff', icon: '' });
      await reload();
    } catch (error) { showError(error); }
  };
  const saveTag = async (keepFields = false) => {
    if (!draft.name.trim()) return setNotice('Tag name is required');
    const duplicate = tags.find(tag => tag.id !== draft.id && tag.name.trim().localeCompare(draft.name.trim(), undefined, { sensitivity: 'accent' }) === 0);
    if (duplicate) {
      if (!draft.id) { setNotice(`A tag named “${duplicate.name}” already exists`); return; }
      if (window.confirm(`A tag named “${duplicate.name}” already exists. Merge the current tag into it?`)) await mergeTags(draft.id, duplicate);
      return;
    }
    const payload = { name: draft.name, groups: draft.groups, color: draft.color, icon: draft.icon };
    try {
      const tag = draft.id ? await request<Tag>(`/tags/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(payload) }) : await request<Tag>('/tags', { method: 'POST', body: JSON.stringify(payload) });
      setTags(items => draft.id ? items.map(item => item.id === tag.id ? tag : item) : [...items, tag]);
      if (!keepFields || draft.id) setDraft({ name: '', groups: [], color: '#7c5cff', icon: '' });
    } catch (error) { showError(error); }
  };
  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    try { const group = await request<Group>('/tag-groups', { method: 'POST', body: JSON.stringify({ name: newGroupName, parentId: newGroupParent || null }) }); setGroups(items => [...items, group]); setNewGroupName(''); setNewGroupParent(''); }
    catch (error) { showError(error); }
  };
  const updateGroup = async (group: Group, name: string, parentId = group.parentId || null) => {
    if (!name.trim() || (name === group.name && parentId === (group.parentId || null))) return;
    try { const updated = await request<Group>(`/tag-groups/${encodeURIComponent(group.id)}`, { method: 'PUT', body: JSON.stringify({ name, parentId }) }); setGroups(items => items.map(item => item.id === updated.id ? updated : item)); }
    catch (error) { showError(error); }
  };
  const toggleGroup = (id: string) => setCollapsedGroups(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  const toggleAssetGroup = (id: string) => setAssetCollapsedGroups(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  const toggleMissingGroup = (id: string) => { setStickyAssetId(null); setMissingGroups(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); };
  const toggleIncludedGroup = (id: string) => { setStickyAssetId(null); setIncludedGroups(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); };
  const toggleKind = (kind: Asset['kind']) => setMediaKinds(items => items.includes(kind) ? items.filter(item => item !== kind) : [...items, kind]);
  const chooseSort = (next: 'name' | 'addedAt') => {
    if (sortBy === next) setSortDirection(value => value === 'asc' ? 'desc' : 'asc');
    else { setSortBy(next); setSortDirection('asc'); }
  };
  const closeApp = async () => {
    try {
      setClosing(true);
      await request('/shutdown', { method: 'POST' });
      window.close();
    } catch (error) { setClosing(false); showError(error); }
  };
  const beginDetailsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeStart({ x: event.clientX, width: detailsWidth });
  };
  const resizeDetails = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeStart) return;
    setDetailsWidth(Math.max(260, Math.min(700, resizeStart.width + resizeStart.x - event.clientX)));
  };
  const deleteTag = async () => {
    if (!draft.id || !window.confirm(`Delete tag “${draft.name}”? It must not be used by any asset.`)) return;
    try { await request(`/tags/${encodeURIComponent(draft.id)}`, { method: 'DELETE' }); setTags(items => items.filter(item => item.id !== draft.id)); openNewTag(); }
    catch (error) { showError(error); }
  };
  const deleteGroup = async (group: Group) => {
    try { await request(`/tag-groups/${encodeURIComponent(group.id)}`, { method: 'DELETE' }); setGroups(items => items.filter(item => item.id !== group.id)); }
    catch (error) { showError(error); }
  };
  const saveTaxonomyOrder = async (nextGroups: Group[], nextTags: Tag[]) => {
    await request('/taxonomy/order', { method: 'PUT', body: JSON.stringify({ groupIds: nextGroups.map(group => group.id), tagIds: nextTags.map(tag => tag.id) }) });
  };
  const moveGroup = async (targetId: string) => {
    if (!dragGroupId || dragGroupId === targetId) return;
    const nextGroups = [...groups];
    const from = nextGroups.findIndex(group => group.id === dragGroupId);
    const to = nextGroups.findIndex(group => group.id === targetId);
    const [dragged] = nextGroups.splice(from, 1);
    nextGroups.splice(to, 0, dragged);
    try { await saveTaxonomyOrder(nextGroups, tags); setGroups(nextGroups); } catch (error) { showError(error); }
    finally { setDragGroupId(null); }
  };
  const moveTag = async (targetId: string) => {
    if (!dragTagId || dragTagId === targetId) return;
    const nextTags = [...tags];
    const from = nextTags.findIndex(tag => tag.id === dragTagId);
    const to = nextTags.findIndex(tag => tag.id === targetId);
    const [dragged] = nextTags.splice(from, 1);
    nextTags.splice(to, 0, dragged);
    try { await saveTaxonomyOrder(groups, nextTags); setTags(nextTags); } catch (error) { showError(error); }
    finally { setDragTagId(null); }
  };
  const sortTagsByFolder = async () => {
    const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
    const folderRank = (tag: Tag) => Math.min(...tag.groups.map(groupId => groupOrder.get(groupId) ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    const nextTags = [...tags].sort((left, right) => {
      const byFolder = folderRank(left) - folderRank(right);
      return byFolder || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    try {
      await saveTaxonomyOrder(groups, nextTags);
      setTags(nextTags);
    } catch (error) { showError(error); }
  };
  const sortGroupTagsToTop = async (groupId: string) => {
    const matches = tags.filter(tag => tag.groups.includes(groupId)).sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (!matches.length) return;
    const matchingIds = new Set(matches.map(tag => tag.id));
    const nextTags = [...matches, ...tags.filter(tag => !matchingIds.has(tag.id))];
    try {
      await saveTaxonomyOrder(groups, nextTags);
      setTags(nextTags);
    } catch (error) { showError(error); }
  };
  useEffect(() => {
    if (!managerOpen || !managerRef.current) return;
    const cleanups = [...managerRef.current.querySelectorAll<HTMLElement>('.group-row')].map((row, index) => {
      const group = groups[index];
      const deleteButton = row.querySelector<HTMLButtonElement>('.delete-small');
      if (!group || !deleteButton) return () => {};
      const sortButton = document.createElement('button');
      sortButton.type = 'button';
      sortButton.className = 'group-sort';
      sortButton.title = `Sort tags from ${group.name} to the top`;
      sortButton.textContent = '⇧';
      row.insertBefore(sortButton, deleteButton);
      const stop = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
      const onSort = (event: Event) => { stop(event); void sortGroupTagsToTop(group.id); };
      let confirming = false;
      const onDelete = (event: Event) => {
        stop(event);
        if (confirming) { void deleteGroup(group); return; }
        confirming = true;
        deleteButton.classList.add('confirm-delete-group');
        deleteButton.textContent = '✓';
        deleteButton.title = 'Confirm folder deletion';
      };
      sortButton.addEventListener('click', onSort);
      deleteButton.addEventListener('click', onDelete);
      return () => {
        sortButton.removeEventListener('click', onSort);
        deleteButton.removeEventListener('click', onDelete);
        sortButton.remove();
        deleteButton.classList.remove('confirm-delete-group');
        deleteButton.textContent = '×';
        deleteButton.title = 'Delete folder';
      };
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [managerOpen, groups, tags]);
  useEffect(() => {
    if (!managerOpen || !managerRef.current) return;
    const manager = managerRef.current;
    let frame = 0;
    const positionColumns = () => {
      frame = 0;
      manager.querySelectorAll<HTMLElement>('.manager-grid > .manager-column').forEach(column => {
        const shift = Math.max(0, manager.scrollTop + manager.getBoundingClientRect().top + manager.clientHeight - column.offsetHeight - column.offsetTop);
        column.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const schedulePosition = () => {
      if (!frame) frame = window.requestAnimationFrame(positionColumns);
    };
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(manager);
    manager.querySelectorAll<HTMLElement>('.manager-grid > .manager-column').forEach(column => observer.observe(column));
    manager.addEventListener('scroll', schedulePosition, { passive: true });
    window.addEventListener('resize', schedulePosition);
    schedulePosition();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      manager.removeEventListener('scroll', schedulePosition);
      window.removeEventListener('resize', schedulePosition);
      manager.querySelectorAll<HTMLElement>('.manager-grid > .manager-column').forEach(column => { column.style.transform = ''; });
    };
  }, [managerOpen, groups.length, tags.length, draft.id]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') { setManagerOpen(false); setIssuesOpen(false); }
      if (event.key === 'u' || event.key === 'U') setUntagged(value => !value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const index = visibleAssets.findIndex(asset => asset.id === selected);
        const next = visibleAssets[index + (event.key === 'ArrowRight' ? 1 : -1)];
        if (next) { setSelected(next.runtimeId); setStickyAssetId(null); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visibleAssets, selected]);
  const renderGroup = (group: Group, depth = 0): ReactNode => {
    if (!groupMatchesTagSearch(group)) return null;
    const children = groups.filter(item => (item.parentId || null) === group.id);
    const directTags = tags.filter(tag => tag.groups.includes(group.id));
    const hasContents = children.length > 0 || directTags.length > 0;
    const isCollapsed = collapsedGroups.includes(group.id);
    const groupNameMatches = group.name.toLowerCase().includes(tagSearchTerm);
    return <section className="tag-group tree-group" key={group.id} style={{ paddingLeft: depth * 10 }}><h2><button className={`tree-toggle ${hasContents ? '' : 'empty'}`} disabled={!hasContents} aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => toggleGroup(group.id)}>{hasContents ? (isCollapsed ? '▸' : '▾') : '·'}</button>{group.name}<span className="folder-filter-actions"><button className={`include-toggle ${includedGroups.includes(group.id) ? 'active' : ''}`} title="Show assets with tags from this folder" onClick={() => toggleIncludedGroup(group.id)}>+</button><button className={`missing-toggle ${missingGroups.includes(group.id) ? 'active' : ''}`} title="Show assets without tags from this folder" onClick={() => toggleMissingGroup(group.id)}>∅</button></span></h2>{!isCollapsed && <>{directTags.filter(tag => !tagSearchTerm || groupNameMatches || tag.name.toLowerCase().includes(tagSearchTerm)).map(tag => <label key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={() => toggleFilter(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}{children.map(child => renderGroup(child, depth + 1))}</>}</section>;
  };
  const renderAssetTagGroup = (group: Group, depth = 0): ReactNode => {
    const directTags = tags.filter(tag => tag.groups.includes(group.id) && (!tagSearchTerm || tag.name.toLowerCase().includes(tagSearchTerm) || group.name.toLowerCase().includes(tagSearchTerm)));
    const children = groups.filter(item => item.parentId === group.id).map(child => renderAssetTagGroup(child, depth + 1)).filter(Boolean);
    if (!directTags.length && !children.length) return null;
    const isCollapsed = assetCollapsedGroups.includes(group.id);
    return <section className="asset-tag-group" key={group.id} style={{ paddingLeft: depth * 9 }}><h3><button className="asset-tree-toggle" title={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => toggleAssetGroup(group.id)}>{isCollapsed ? '▸' : '▾'}</button>{group.name}</h3>{!isCollapsed && <>{directTags.map(tag => <label key={tag.id}><input type="checkbox" checked={current?.tags.includes(tag.id) || false} onChange={() => toggleAssetTag(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}{children}</>}</section>;
  };

  if (!library?.open) return <main className="welcome"><div><p className="eyebrow">REFERENCE LIBRARY</p><h1>Your visual memory, locally owned.</h1><p>Select the single folder that will hold media, sidecars, and `.library` configuration.</p><button onClick={choose}>Choose Library folder</button>{notice && <p className="notice">{notice}</p>}</div></main>;
  if (library.initialized === false) return <main className="welcome"><div><p className="eyebrow">NEW LIBRARY</p><h1>Initialize this folder?</h1><p><code>{pendingPath}</code></p><p>This only creates `.library/config.json` and `.library/tags.json`. Your media files will not move or change.</p><button onClick={initialize}>Initialize Library</button><button className="secondary" onClick={choose}>Choose another folder</button>{notice && <p className="notice">{notice}</p>}</div></main>;

  if (closing) return <main className="welcome"><div><p className="eyebrow">REFERENCE LIBRARY</p><h1>Server stopped.</h1><p>You can close this browser tab.</p></div></main>;
  return <main className="app">
    <header><div><p className="eyebrow">LIBRARY</p><h1>{library.name}</h1></div><input aria-label="Search files" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search filename or path" /><input className="tag-header-search" aria-label="Search tags" value={tagSearch} onChange={event => setTagSearch(event.target.value)} placeholder="Search tags" /><button className="secondary" onClick={openNewTag}>New tag</button><button className="secondary" onClick={() => setManagerOpen(true)}>Manage tags</button><button className="secondary" onClick={rescan}>{loading ? 'Loading…' : 'Rescan'}</button><button className="secondary" onClick={choose}>Change folder</button><button className="danger" onClick={closeApp}>Close</button></header>
    {(notice || library.errors?.length) && <div className="notice">{notice || `${library.errors?.length} library issue(s)`}<button onClick={() => notice ? setNotice('') : setIssuesOpen(true)}>×</button></div>}
    <section className="workspace" style={{ gridTemplateColumns: `210px minmax(350px, 1fr) 8px ${detailsWidth}px` }}>
      <aside className="filters"><div className="side-title"><span>Filters</span><button onClick={() => { setSelectedTags([]); setIncludedGroups([]); setMissingGroups([]); setUntagged(false); setMediaKinds([]); setAnimatedGifs(false); setStickyAssetId(null); }}>Clear</button></div><section className="tag-group"><h2>Media type</h2><label><input type="checkbox" checked={mediaKinds.includes('image')} onChange={() => toggleKind('image')} /> Images <small>{assets.filter(asset => asset.kind === 'image').length}</small></label><label><input type="checkbox" checked={mediaKinds.includes('video')} onChange={() => toggleKind('video')} /> Videos <small>{assets.filter(asset => asset.kind === 'video').length}</small></label><label><input type="checkbox" checked={animatedGifs} onChange={event => setAnimatedGifs(event.target.checked)} /> ⟳ Animated GIF <small>{assets.filter(asset => asset.isAnimatedGif).length}</small></label></section><label className="untagged"><input type="checkbox" checked={untagged} onChange={event => setUntagged(event.target.checked)} /> Untagged <small>{assets.filter(asset => asset.untagged).length}</small></label>
        {groups.filter(group => !group.parentId).map(group => renderGroup(group))}
        {tags.filter(tag => !tag.groups.length).length > 0 && <section className="tag-group"><h2>Other</h2>{tags.filter(tag => !tag.groups.length).map(tag => <label key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={() => toggleFilter(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}</section>}
      </aside>
      <section className="gallery"><div className="gallery-bar"><span>{visibleAssets.length} assets</span><div className="sort-control"><button className={sortBy === 'name' ? 'active' : ''} onClick={() => chooseSort('name')}>Name {sortBy === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}</button><button className={sortBy === 'addedAt' ? 'active' : ''} onClick={() => chooseSort('addedAt')}>Date {sortBy === 'addedAt' && (sortDirection === 'asc' ? '↑' : '↓')}</button></div><label className="size-control">Size <input type="range" min="110" max="300" value={cardSize} onChange={event => setCardSize(Number(event.target.value))} /></label>{(selectedTags.length > 0 || missingGroups.length > 0) && <span>AND match</span>}</div><div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>{visibleAssets.map(asset => <button className={`card ${selected === asset.runtimeId || selected === asset.id ? 'selected' : ''}`} key={asset.runtimeId} onClick={() => { setSelected(asset.runtimeId); setStickyAssetId(null); }}><div className={`thumb ${asset.kind === 'video' ? 'video-thumb' : ''}`} style={{ height: Math.round(cardSize * 0.78) }}>{asset.kind === 'image' ? <img loading="lazy" src={`${api}/media/${encodeURIComponent(asset.runtimeId)}`} alt="" /> : <video muted preload="metadata" src={`${api}/media/${encodeURIComponent(asset.runtimeId)}`} />}</div><span><i className="media-icon" title={asset.isAnimatedGif ? 'Animated GIF' : asset.kind === 'video' ? 'Video' : 'Image'}>{asset.isAnimatedGif ? '⟳' : asset.kind === 'video' ? '▶' : '▣'}</i>{asset.name}</span>{asset.errors.length > 0 && <b title={asset.errors.join('\n')}>!</b>}</button>)}</div>{visibleAssets.length === 0 && <p className="empty">Nothing matches these filters.</p>}</section>
      <div className="details-resizer" onPointerDown={beginDetailsResize} onPointerMove={resizeDetails} onPointerUp={() => setResizeStart(null)} />
      <aside className="details">{current ? <><div className="preview">{current.kind === 'image' ? <img src={`${api}/media/${encodeURIComponent(current.runtimeId)}`} alt={current.name} /> : <video ref={previewVideoRef} controls autoPlay loop preload="auto" onCanPlay={event => { event.currentTarget.volume = videoVolume; void event.currentTarget.play().catch(() => {}); }} onVolumeChange={event => setVideoVolume(event.currentTarget.volume)} src={`${api}/media/${encodeURIComponent(current.runtimeId)}`} />}</div><div className="asset-title"><div><h2>{/^https?:\/\//i.test(current.link) ? <a className="asset-name-link" href={current.link} target="_blank" rel="noreferrer">{current.name}</a> : current.name}</h2><p className="path">{current.relativePath}</p></div><button className={`comment-toggle ${detailsOpen ? 'active' : ''}`} title="Show or edit details" onClick={() => setDetailsOpen(value => !value)}>Детали</button></div>{detailsOpen && <section className="asset-details"><label>Комментарий<textarea className="comment-editor" value={detailsDraft.comment} onChange={event => updateDetails('comment', event.target.value)} placeholder="Добавьте комментарий" /></label><label>Ссылка<input className="details-link" type="url" value={detailsDraft.link} onChange={event => updateDetails('link', event.target.value)} placeholder="https://example.com" /></label><p className="details-save-status">Сохраняется автоматически</p></section>}<h2>Tags</h2><div className="asset-tag-editor">{groups.filter(group => !group.parentId).map(group => renderAssetTagGroup(group))}{tags.filter(tag => !tag.groups.length && (!tagSearchTerm || tag.name.toLowerCase().includes(tagSearchTerm))).map(tag => <label key={tag.id}><input type="checkbox" checked={current.tags.includes(tag.id)} onChange={() => toggleAssetTag(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}</div><button className="text-button" onClick={openNewTag}>+ New tag</button>{current.errors.length > 0 && <section className="errors"><h2>Metadata issues</h2>{current.errors.map(error => <p key={error}>{error}</p>)}</section>}</> : <div className="empty">Select an asset to preview and tag it.</div>}</aside>
    </section>
    {managerOpen && <div className="modal-backdrop" onMouseDown={() => setManagerOpen(false)}><section className="manager" ref={managerRef} onMouseDown={event => event.stopPropagation()}><div className="manager-head"><div><p className="eyebrow">LIBRARY TAXONOMY</p><h2>Manage tags</h2></div><button className="secondary" onClick={() => setManagerOpen(false)}>Close</button></div><div className="manager-grid"><section className="manager-column"><h3>Folders</h3><p className="helper">Drag ⠿ to reorder. Rename a folder, then press Enter or click outside.</p>{groups.map(group => <div className="group-row" key={group.id} draggable onDragStart={() => setDragGroupId(group.id)} onDragOver={event => event.preventDefault()} onDrop={() => moveGroup(group.id)}><span className="drag-handle" title="Drag to reorder">⠿</span><input aria-label={`Rename folder ${group.name}`} className="group-name" defaultValue={group.name} title="Rename folder" onBlur={event => updateGroup(group, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><select value={group.parentId || ''} onChange={event => updateGroup(group, group.name, event.target.value || null)}><option value="">Top level</option>{groups.filter(item => item.id !== group.id).map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select><button className="delete-small" title="Delete folder" onClick={() => deleteGroup(group)}>×</button></div>)}<div className="new-group"><input value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="New folder" /><select value={newGroupParent} onChange={event => setNewGroupParent(event.target.value)}><option value="">Top level</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select><button onClick={createGroup}>Add folder</button></div></section><section className="manager-column"><div className="tag-list-head"><h3>Tags</h3><div className="manager-tag-filter-wrap"><input className="manager-tag-filter" aria-label="Filter tags by name" value={managerTagSearch} onChange={event => setManagerTagSearch(event.target.value)} placeholder="Filter tags" />{managerTagSearch && <button className="clear-manager-tag-filter" aria-label="Clear tag filter" title="Clear filter" onClick={() => setManagerTagSearch('')}>×</button>}</div><div className="tag-list-actions"><button onClick={sortTagsByFolder} title="Sort tags by folder and name">Sort</button><button className="manager-new-tag" onClick={openNewTag}>New tag</button></div></div><p className="helper">Drag ⠿ to reorder. Select a tag to rename or edit it.</p><div className="manage-tag-list">{tags.filter(tag => !managerTagSearchTerm || tag.name.toLowerCase().includes(managerTagSearchTerm)).map(tag => <button key={tag.id} draggable onDragStart={() => setDragTagId(tag.id)} onDragOver={event => event.preventDefault()} onDrop={() => moveTag(tag.id)} className={draft.id === tag.id ? 'active' : ''} title={`Edit or rename ${tag.name}`} onClick={() => editTag(tag)}><span className="drag-handle" title="Drag to reorder">⠿</span><i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}<span className="edit-mark">✎</span><span className="copy-mark" role="button" title="Copy tag" onClick={event => { event.stopPropagation(); copyTag(tag); }}>⧉</span></button>)}</div></section><section className="tag-form manager-column"><h3>{draft.id ? 'Rename / edit tag' : 'New tag'}</h3><label>Tag name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Blonde" /></label><label>Icon <span className="helper">optional emoji or symbol</span><input value={draft.icon || ''} onChange={event => setDraft({ ...draft, icon: event.target.value })} placeholder="Optional" /></label><label>Color<input type="color" value={draft.color || '#7c5cff'} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label><fieldset><legend>Folders</legend>{groups.map(group => <label key={group.id}><input type="checkbox" checked={draft.groups.includes(group.id)} onChange={() => setDraft({ ...draft, groups: draft.groups.includes(group.id) ? draft.groups.filter(id => id !== group.id) : [...draft.groups, group.id] })} /> {group.name}</label>)}</fieldset><div className="tag-actions"><button onClick={() => saveTag(false)}>{draft.id ? 'Save changes' : 'Create tag'}</button>{!draft.id && <button className="secondary" onClick={() => saveTag(true)}>Create & keep fields</button>}</div>{draft.id && <button className="danger delete-tag" onClick={deleteTag}>Delete tag</button>}</section></div></section></div>}
    {issuesOpen && <div className="modal-backdrop" onMouseDown={() => setIssuesOpen(false)}><section className="issues manager" onMouseDown={event => event.stopPropagation()}><div className="manager-head"><h2>Library issues</h2><button className="secondary" onClick={() => setIssuesOpen(false)}>Close</button></div>{library.errors?.map(error => <p key={error}>{error}</p>)}{assets.filter(asset => asset.errors.length).map(asset => <section key={asset.id}><strong>{asset.relativePath}</strong>{asset.errors.map(error => <p key={error}>{error}</p>)}</section>)}</section></div>}
  </main>;
}
