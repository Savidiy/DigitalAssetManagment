import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type Tag = { id: string; name: string; groups: string[]; color?: string | null; icon?: string | null };
type Group = { id: string; name: string; parentId?: string | null };
type Asset = { id: string; name: string; relativePath: string; kind: 'image' | 'video'; isAnimatedGif: boolean; addedAt: number; comment: string; tags: string[]; untagged: boolean; errors: string[] };
type Library = { open?: boolean; path?: string; name?: string; initialized?: boolean; cancelled?: boolean; errors?: string[] };
type UiSettings = { selectedTags?: string[]; missingGroups?: string[]; untagged?: boolean; mediaKinds?: Asset['kind'][]; animatedGifs?: boolean; sortBy?: 'name' | 'addedAt'; sortDirection?: 'asc' | 'desc'; search?: string; cardSize?: number; detailsWidth?: number };
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
  const [draft, setDraft] = useState<Omit<Tag, 'id'> & { id?: string }>({ name: '', groups: [], color: '#7c5cff', icon: '🏷️' });
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
  const [commentDraft, setCommentDraft] = useState('');
  const restoredLibraryPath = useRef<string | null>(null);

  const restoreUiSettings = (path: string) => {
    if (restoredLibraryPath.current === path) return;
    restoredLibraryPath.current = path;
    let saved: UiSettings = {};
    try { saved = JSON.parse(localStorage.getItem(`reference-library-ui:${path}`) || '{}') as UiSettings; } catch { /* Use defaults if local storage is malformed. */ }
    setSelectedTags(Array.isArray(saved.selectedTags) ? saved.selectedTags : []);
    setMissingGroups(Array.isArray(saved.missingGroups) ? saved.missingGroups : []);
    setUntagged(Boolean(saved.untagged));
    setMediaKinds(Array.isArray(saved.mediaKinds) ? saved.mediaKinds.filter(kind => kind === 'image' || kind === 'video') : []);
    setAnimatedGifs(Boolean(saved.animatedGifs));
    setSortBy(saved.sortBy === 'addedAt' ? 'addedAt' : 'name');
    setSortDirection(saved.sortDirection === 'desc' ? 'desc' : 'asc');
    setSearch(typeof saved.search === 'string' ? saved.search : '');
    setCardSize(typeof saved.cardSize === 'number' ? Math.max(110, Math.min(300, saved.cardSize)) : 160);
    setDetailsWidth(typeof saved.detailsWidth === 'number' ? Math.max(260, Math.min(700, saved.detailsWidth)) : 350);
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
    const settings: UiSettings = { selectedTags, missingGroups, untagged, mediaKinds, animatedGifs, sortBy, sortDirection, search, cardSize, detailsWidth };
    localStorage.setItem(`reference-library-ui:${library.path}`, JSON.stringify(settings));
  }, [library?.path, selectedTags, missingGroups, untagged, mediaKinds, animatedGifs, sortBy, sortDirection, search, cardSize, detailsWidth]);

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
  const current = assets.find(asset => asset.id === selected) ?? null;
  useEffect(() => { setCommentDraft(current?.comment || ''); }, [current?.id]);
  const tagById = new Map(tags.map(tag => [tag.id, tag]));
  const groupTree = (groupId: string): string[] => [groupId, ...groups.filter(group => group.parentId === groupId).flatMap(group => groupTree(group.id))];
  const tagSearchTerm = tagSearch.trim().toLowerCase();
  const groupMatchesTagSearch = (group: Group) => !tagSearchTerm || group.name.toLowerCase().includes(tagSearchTerm) || tags.some(tag => tag.name.toLowerCase().includes(tagSearchTerm) && tag.groups.some(id => groupTree(group.id).includes(id)));
  const visibleAssets = useMemo(() => assets.filter(asset => {
    const matchingTags = selectedTags.every(tag => asset.tags.includes(tag));
    const matchingInbox = !untagged || asset.untagged;
    const matchingKind = !mediaKinds.length || mediaKinds.includes(asset.kind);
    const matchingAnimation = !animatedGifs || asset.isAnimatedGif;
    const matchingMissingFolders = missingGroups.every(groupId => {
      const folderIds = new Set(groupTree(groupId));
      return !asset.tags.some(tagId => tagById.get(tagId)?.groups.some(id => folderIds.has(id)));
    });
    const needle = search.trim().toLowerCase();
    return asset.id === stickyAssetId || (matchingTags && matchingInbox && matchingKind && matchingAnimation && matchingMissingFolders && (!needle || `${asset.relativePath} ${asset.comment}`.toLowerCase().includes(needle)));
  }).sort((left, right) => {
    const comparison = sortBy === 'name' ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) : left.addedAt - right.addedAt;
    return sortDirection === 'asc' ? comparison : -comparison;
  }), [assets, selectedTags, untagged, mediaKinds, animatedGifs, missingGroups, search, groups, tags, stickyAssetId, sortBy, sortDirection]);
  const toggleFilter = (tag: string) => setSelectedTags(currentTags => currentTags.includes(tag) ? currentTags.filter(item => item !== tag) : [...currentTags, tag]);
  const updateTags = async (next: string[]) => {
    if (!current) return;
    try {
      const updated = await request<Asset>(`/assets/${encodeURIComponent(current.id)}/tags`, { method: 'PUT', body: JSON.stringify({ tags: next }) });
      setAssets(items => items.map(item => item.id === current.id ? updated : item));
      setSelected(updated.id);
      setStickyAssetId(missingGroups.length ? updated.id : null);
    } catch (error) { showError(error); }
  };
  const saveComment = async () => {
    if (!current || commentDraft === current.comment) return;
    try {
      const updated = await request<Asset>(`/assets/${encodeURIComponent(current.id)}/comment`, { method: 'PUT', body: JSON.stringify({ comment: commentDraft }) });
      setAssets(items => items.map(item => item.id === current.id ? updated : item));
      setSelected(updated.id);
    } catch (error) { showError(error); }
  };
  const openNewTag = () => { setDraft({ name: '', groups: [], color: '#7c5cff', icon: '🏷️' }); setManagerOpen(true); };
  const editTag = (tag: Tag) => { setDraft({ ...tag, color: tag.color || '#7c5cff', icon: tag.icon || '' }); setManagerOpen(true); };
  const saveTag = async () => {
    if (!draft.name.trim()) return setNotice('Tag name is required');
    const payload = { name: draft.name, groups: draft.groups, color: draft.color, icon: draft.icon };
    try {
      const tag = draft.id ? await request<Tag>(`/tags/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(payload) }) : await request<Tag>('/tags', { method: 'POST', body: JSON.stringify(payload) });
      setTags(items => draft.id ? items.map(item => item.id === tag.id ? tag : item) : [...items, tag]);
      setDraft({ name: '', groups: [], color: '#7c5cff', icon: '🏷️' });
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
  const toggleMissingGroup = (id: string) => { setStickyAssetId(null); setMissingGroups(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); };
  const toggleKind = (kind: Asset['kind']) => setMediaKinds(items => items.includes(kind) ? items.filter(item => item !== kind) : [...items, kind]);
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
    if (!window.confirm(`Delete folder “${group.name}”? It must be empty.`)) return;
    try { await request(`/tag-groups/${encodeURIComponent(group.id)}`, { method: 'DELETE' }); setGroups(items => items.filter(item => item.id !== group.id)); }
    catch (error) { showError(error); }
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') { setManagerOpen(false); setIssuesOpen(false); }
      if (event.key === 'u' || event.key === 'U') setUntagged(value => !value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const index = visibleAssets.findIndex(asset => asset.id === selected);
        const next = visibleAssets[index + (event.key === 'ArrowRight' ? 1 : -1)];
        if (next) { setSelected(next.id); setStickyAssetId(null); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visibleAssets, selected]);
  const renderGroup = (group: Group, depth = 0): ReactNode => {
    if (!groupMatchesTagSearch(group)) return null;
    const children = groups.filter(item => (item.parentId || null) === group.id);
    const isCollapsed = collapsedGroups.includes(group.id);
    const groupNameMatches = group.name.toLowerCase().includes(tagSearchTerm);
    return <section className="tag-group tree-group" key={group.id} style={{ paddingLeft: depth * 10 }}><h2><button className="tree-toggle" onClick={() => toggleGroup(group.id)}>{children.length ? (isCollapsed ? '›' : '⌄') : '·'}</button>{group.name}<button className={`missing-toggle ${missingGroups.includes(group.id) ? 'active' : ''}`} title="Show assets without tags from this folder" onClick={() => toggleMissingGroup(group.id)}>∅</button></h2>{!isCollapsed && <>{tags.filter(tag => tag.groups.includes(group.id) && (!tagSearchTerm || groupNameMatches || tag.name.toLowerCase().includes(tagSearchTerm))).map(tag => <label key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={() => toggleFilter(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}{children.map(child => renderGroup(child, depth + 1))}</>}</section>;
  };

  if (!library?.open) return <main className="welcome"><div><p className="eyebrow">REFERENCE LIBRARY</p><h1>Your visual memory, locally owned.</h1><p>Select the single folder that will hold media, sidecars, and `.library` configuration.</p><button onClick={choose}>Choose Library folder</button>{notice && <p className="notice">{notice}</p>}</div></main>;
  if (library.initialized === false) return <main className="welcome"><div><p className="eyebrow">NEW LIBRARY</p><h1>Initialize this folder?</h1><p><code>{pendingPath}</code></p><p>This only creates `.library/config.json` and `.library/tags.json`. Your media files will not move or change.</p><button onClick={initialize}>Initialize Library</button><button className="secondary" onClick={choose}>Choose another folder</button>{notice && <p className="notice">{notice}</p>}</div></main>;

  if (closing) return <main className="welcome"><div><p className="eyebrow">REFERENCE LIBRARY</p><h1>Server stopped.</h1><p>You can close this browser tab.</p></div></main>;
  return <main className="app">
    <header><div><p className="eyebrow">LIBRARY</p><h1>{library.name}</h1></div><input aria-label="Search files" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search filename or path" /><button className="secondary" onClick={openNewTag}>New tag</button><button className="secondary" onClick={() => setManagerOpen(true)}>Manage tags</button><button className="secondary" onClick={rescan}>{loading ? 'Loading…' : 'Rescan'}</button><button className="secondary" onClick={choose}>Change folder</button><button className="danger" onClick={closeApp}>Close</button></header>
    {(notice || library.errors?.length) && <div className="notice">{notice || `${library.errors?.length} library issue(s)`}<button onClick={() => notice ? setNotice('') : setIssuesOpen(true)}>×</button></div>}
    <section className="workspace" style={{ gridTemplateColumns: `210px minmax(350px, 1fr) 8px ${detailsWidth}px` }}>
      <aside className="filters"><div className="side-title"><span>Filters</span><button onClick={() => { setSelectedTags([]); setMissingGroups([]); setUntagged(false); setMediaKinds([]); setAnimatedGifs(false); setStickyAssetId(null); }}>Clear</button></div><input className="tag-search" value={tagSearch} onChange={event => setTagSearch(event.target.value)} placeholder="Search tags and folders" /><section className="tag-group"><h2>Media type</h2><label><input type="checkbox" checked={mediaKinds.includes('image')} onChange={() => toggleKind('image')} /> Images <small>{assets.filter(asset => asset.kind === 'image').length}</small></label><label><input type="checkbox" checked={mediaKinds.includes('video')} onChange={() => toggleKind('video')} /> Videos <small>{assets.filter(asset => asset.kind === 'video').length}</small></label><label><input type="checkbox" checked={animatedGifs} onChange={event => setAnimatedGifs(event.target.checked)} /> ⟳ Animated GIF <small>{assets.filter(asset => asset.isAnimatedGif).length}</small></label></section><label className="untagged"><input type="checkbox" checked={untagged} onChange={event => setUntagged(event.target.checked)} /> Untagged <small>{assets.filter(asset => asset.untagged).length}</small></label>
        {groups.filter(group => !group.parentId).map(group => renderGroup(group))}
        {tags.filter(tag => !tag.groups.length).length > 0 && <section className="tag-group"><h2>Other</h2>{tags.filter(tag => !tag.groups.length).map(tag => <label key={tag.id}><input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={() => toggleFilter(tag.id)} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}</section>}
      </aside>
      <section className="gallery"><div className="gallery-bar"><span>{visibleAssets.length} assets</span><label className="sort-control">Sort <select value={sortBy} onChange={event => setSortBy(event.target.value as 'name' | 'addedAt')}><option value="name">Name</option><option value="addedAt">Date added</option></select><button title={sortDirection === 'asc' ? 'Ascending' : 'Descending'} onClick={() => setSortDirection(value => value === 'asc' ? 'desc' : 'asc')}>{sortDirection === 'asc' ? '↑' : '↓'}</button></label><label className="size-control">Size <input type="range" min="110" max="300" value={cardSize} onChange={event => setCardSize(Number(event.target.value))} /></label>{(selectedTags.length > 0 || missingGroups.length > 0) && <span>AND match</span>}</div><div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }}>{visibleAssets.map(asset => <button className={`card ${selected === asset.id ? 'selected' : ''}`} key={asset.id} onClick={() => { setSelected(asset.id); setStickyAssetId(null); }}><div className={`thumb ${asset.kind === 'video' ? 'video-thumb' : ''}`} style={{ height: Math.round(cardSize * 0.78) }}>{asset.kind === 'image' ? <img loading="lazy" src={`${api}/media/${encodeURIComponent(asset.id)}`} alt="" /> : <><video muted preload="metadata" src={`${api}/media/${encodeURIComponent(asset.id)}`} /><img loading="lazy" src={`${api}/thumbnails/${encodeURIComponent(asset.id)}`} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /><span>▶</span></>}</div><span>{asset.isAnimatedGif && <i className="media-icon" title="Animated GIF">⟳</i>}{asset.name}</span>{asset.errors.length > 0 && <b title={asset.errors.join('\n')}>!</b>}</button>)}</div>{visibleAssets.length === 0 && <p className="empty">Nothing matches these filters.</p>}</section>
      <div className="details-resizer" onPointerDown={beginDetailsResize} onPointerMove={resizeDetails} onPointerUp={() => setResizeStart(null)} />
      <aside className="details">{current ? <><div className="preview">{current.kind === 'image' ? <img src={`${api}/media/${encodeURIComponent(current.id)}`} alt={current.name} /> : <video controls src={`${api}/media/${encodeURIComponent(current.id)}`} />}</div><p className="path">{current.relativePath}</p><h2>Tags</h2><div className="tag-editor">{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={current.tags.includes(tag.id)} onChange={() => updateTags(current.tags.includes(tag.id) ? current.tags.filter(id => id !== tag.id) : [...current.tags, tag.id])} /> <i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}</label>)}</div><button className="text-button" onClick={openNewTag}>+ New tag</button><h2>Comment</h2><textarea className="comment-editor" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} placeholder="Add a note about this reference" /><button className="secondary comment-save" onClick={saveComment} disabled={commentDraft === current.comment}>Save comment</button>{current.errors.length > 0 && <section className="errors"><h2>Metadata issues</h2>{current.errors.map(error => <p key={error}>{error}</p>)}</section>}</> : <div className="empty">Select an asset to preview and tag it.</div>}</aside>
    </section>
    {managerOpen && <div className="modal-backdrop" onMouseDown={() => setManagerOpen(false)}><section className="manager" onMouseDown={event => event.stopPropagation()}><div className="manager-head"><div><p className="eyebrow">LIBRARY TAXONOMY</p><h2>Manage tags</h2></div><button className="secondary" onClick={() => setManagerOpen(false)}>Close</button></div><div className="manager-grid"><section><h3>Folders</h3><p className="helper">Rename a folder in its name field, then press Enter or click outside.</p>{groups.map(group => <div className="group-row" key={group.id}><input aria-label={`Rename folder ${group.name}`} className="group-name" defaultValue={group.name} title="Rename folder" onBlur={event => updateGroup(group, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><select value={group.parentId || ''} onChange={event => updateGroup(group, group.name, event.target.value || null)}><option value="">Top level</option>{groups.filter(item => item.id !== group.id).map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select><button className="delete-small" title="Delete folder" onClick={() => deleteGroup(group)}>×</button></div>)}<div className="new-group"><input value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="New folder" /><select value={newGroupParent} onChange={event => setNewGroupParent(event.target.value)}><option value="">Top level</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select><button onClick={createGroup}>Add folder</button></div></section><section><div className="tag-list-head"><h3>Tags</h3><button onClick={openNewTag}>New tag</button></div><p className="helper">Select a tag to rename or edit it.</p><div className="manage-tag-list">{tags.map(tag => <button key={tag.id} className={draft.id === tag.id ? 'active' : ''} title={`Edit or rename ${tag.name}`} onClick={() => editTag(tag)}><i className="tag-dot" style={{ background: tag.color || '#777' }} />{tag.icon} {tag.name}<span className="edit-mark">✎</span></button>)}</div></section><section className="tag-form"><h3>{draft.id ? 'Rename / edit tag' : 'New tag'}</h3><label>Tag name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Blonde" /></label><label>Icon <span className="helper">any emoji or symbol</span><input value={draft.icon || ''} onChange={event => setDraft({ ...draft, icon: event.target.value })} placeholder="🏷️" /></label><label>Color<input type="color" value={draft.color || '#7c5cff'} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label><fieldset><legend>Folders</legend>{groups.map(group => <label key={group.id}><input type="checkbox" checked={draft.groups.includes(group.id)} onChange={() => setDraft({ ...draft, groups: draft.groups.includes(group.id) ? draft.groups.filter(id => id !== group.id) : [...draft.groups, group.id] })} /> {group.name}</label>)}</fieldset><button onClick={saveTag}>{draft.id ? 'Save changes' : 'Create tag'}</button>{draft.id && <button className="danger delete-tag" onClick={deleteTag}>Delete tag</button>}</section></div></section></div>}
    {issuesOpen && <div className="modal-backdrop" onMouseDown={() => setIssuesOpen(false)}><section className="issues manager" onMouseDown={event => event.stopPropagation()}><div className="manager-head"><h2>Library issues</h2><button className="secondary" onClick={() => setIssuesOpen(false)}>Close</button></div>{library.errors?.map(error => <p key={error}>{error}</p>)}{assets.filter(asset => asset.errors.length).map(asset => <section key={asset.id}><strong>{asset.relativePath}</strong>{asset.errors.map(error => <p key={error}>{error}</p>)}</section>)}</section></div>}
  </main>;
}
