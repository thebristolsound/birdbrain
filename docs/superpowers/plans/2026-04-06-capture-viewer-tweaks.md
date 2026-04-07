## User

<command-name>/model</command-name>
            <command-message>model</command-message>
            <command-args>default</command-args><local-command-stdout>Set model to claude-opus-4-6[1m]</local-command-stdout>I'd like to fix the layout on the Capture viewer, right now if you resize any of thew window it looks like shit. It
doesn't make sense to have the sub-tabs like "Page" "HTML" "Source" tab switcher anchored to the bottom of the iframe /
 webView window. I think this design should be nested at the top. I'll provide you with some screenshots, I'd like you
to use brainstorming along with the frontend dev tool to come up with a better layout for this screen.[Image #1][Image
#2]

## Assistant

<thinking>
The user wants to fix the layout of the Capture viewer. They've provided screenshots and want me to use the brainstorming skill first, then the frontend-developer agent. Let me start by invoking the brainstorming skill.
</thinking>

**Tool Call: Skill**
Status: Completed

Launching skill: superpowers:brainstorming

**Tool Call: ToolSearch**
Status: Completed

Tool: TodoWrite

## Assistant

<thinking>
Let me start by setting up the brainstorming tasks and exploring the project context. I need to look at the screenshots first, then explore the CaptureViewer component code.
</thinking>

Let me look at the screenshots and explore the current CaptureViewer code.

**Tool Call: Read src\renderer\components\captures\CaptureViewer.tsx**
Status: Completed

```
1	import { useState, useEffect, useCallback } from 'react'
2	import { useParams } from '@tanstack/react-router'
3	import { useQuery } from '@tanstack/react-query'
4	import { useAppStore } from '@renderer/stores/appStore'
5	import {
6	  capturesQueryOptions,
7	  tagsQueryOptions,
8	  tagsForCaptureQueryOptions,
9	  useTagsMutations,
10	  useCapturesMutations
11	} from '@renderer/lib/queries'
12	import { TagBadge } from '@renderer/components/tags/TagBadge'
13	import type { Capture } from '@shared/types'
14	import {
15	  ChevronLeft,
16	  ChevronRight,
17	  Download,
18	  ExternalLink,
19	  Trash2,
20	  Image,
21	  Globe,
22	  Code,
23	  FileText,
24	  Info,
25	  Tag as TagIcon,
26	  Plus,
27	  StickyNote
28	} from 'lucide-react'
29	import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
30	import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
31	import { ProvenanceBadge } from '@renderer/components/captures/ProvenanceBadge'
32	
33	type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'metadata'
34	
35	const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'metadata']
36	
37	const TAB_ICONS: Record<ViewTab, typeof Image> = {
38	  screenshot: Image,
39	  page: Globe,
40	  source: Code,
41	  text: FileText,
42	  metadata: Info
43	}
44	
45	const TAB_LABELS: Record<ViewTab, string> = {
46	  screenshot: 'Screenshot',
47	  page: 'Page',
48	  source: 'Source',
49	  text: 'Text',
50	  metadata: 'Metadata'
51	}
52	
53	function formatViewerTimestamp(ts: string): string {
54	  const diff = Date.now() - new Date(ts).getTime()
55	  const mins = Math.floor(diff / 60000)
56	  if (mins < 1) return 'Just now'
57	  if (mins < 60) return `${mins} min ago`
58	  const hours = Math.floor(mins / 60)
59	  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
60	  return new Date(ts).toLocaleDateString()
61	}
62	
63	export function CaptureViewer() {
64	  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
65	  const selectedCaptureId = useAppStore((s) => s.selectedCaptureId)
66	  const selectCapture = useAppStore((s) => s.selectCapture)
67	  const { data: captures = [] } = useQuery(capturesQueryOptions(caseId))
68	  const { data: allTags = [] } = useQuery(tagsQueryOptions)
69	  const { data: captureTags = [] } = useQuery(tagsForCaptureQueryOptions(selectedCaptureId ?? ''))
70	  const { addToCapture, removeFromCapture } = useTagsMutations()
71	  const { remove: deleteCaptureMutation } = useCapturesMutations(caseId)
72	
73	  const [activeTab, setActiveTab] = useState<ViewTab>('screenshot')
74	  const [capture, setCapture] = useState<Capture | null>(null)
75	  const [content, setContent] = useState<string | null>(null)
76	  const [showTagMenu, setShowTagMenu] = useState(false)
77	  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
78	  const [showAddNote, setShowAddNote] = useState(false)
79	
80	  useEffect(() => {
81	    if (selectedCaptureId) {
82	      window.birdbrain.captures
83	        .get(selectedCaptureId)
84	        .then((c) => setCapture(c ?? null))
85	        .catch((err) => console.error('Failed to load capture:', err))
86	    } else {
87	      setCapture(null)
88	      setContent(null)
89	    }
90	  }, [selectedCaptureId])
91	
92	  // Load content when tab changes
93	  useEffect(() => {
94	    if (!selectedCaptureId) return
95	    setContent(null)
96	    // For MHTML captures, the 'page' tab uses MhtmlViewer (file URL); only
97	    // source/text/screenshot tabs need raw content fetching.
98	    if (capture?.format === 'mhtml' && activeTab === 'page') return
99	    const type =
100	      activeTab === 'screenshot'
101	        ? 'png'
102	        : activeTab === 'page' || activeTab === 'source'
103	          ? 'html'
104	          : activeTab === 'text'
105	            ? 'txt'
106	            : null
107	    if (type) {
108	      window.birdbrain.captures
109	        .getContent(selectedCaptureId, type)
110	        .then(setContent)
111	        .catch((err) => console.error('Failed to load capture content:', err))
112	    }
113	  }, [selectedCaptureId, activeTab, capture?.format])
114	
115	  const handleToggleTag = useCallback(
116	    async (tagId: string) => {
117	      if (!selectedCaptureId) return
118	      const hasTag = captureTags.some((t) => t.id === tagId)
119	      if (hasTag) {
120	        await removeFromCapture.mutateAsync({ captureId: selectedCaptureId, tagId })
121	      } else {
122	        await addToCapture.mutateAsync({ captureId: selectedCaptureId, tagId })
123	      }
124	    },
125	    [selectedCaptureId, captureTags, addToCapture, removeFromCapture]
126	  )
127	
128	  const handleDownload = async () => {
129	    if (!selectedCaptureId) return
130	    await window.birdbrain.captures.download(selectedCaptureId)
131	  }
132	
133	  const handleOpenExternal = async () => {
134	    if (!capture) return
135	    await window.birdbrain.captures.openExternal(capture.url)
136	  }
137	
138	  const handleDelete = async () => {
139	    if (!selectedCaptureId) return
140	    const deletedId = selectedCaptureId
141	    await deleteCaptureMutation.mutateAsync(deletedId)
142	    setShowDeleteConfirm(false)
143	    // Navigate away: pick sibling capture or clear selection
144	    const remaining = captures.filter((c) => c.id !== deletedId)
145	    if (remaining.length > 0) {
146	      selectCapture(remaining[0].id)
147	    } else {
148	      useAppStore.getState().setSelectedCaptureId(null)
149	    }
150	  }
151	
152	  // Navigation
153	  const currentIndex = captures.findIndex((c) => c.id === selectedCaptureId)
154	  const goPrev = useCallback(() => {
155	    if (currentIndex > 0) selectCapture(captures[currentIndex - 1].id)
156	  }, [currentIndex, captures, selectCapture])
157	  const goNext = useCallback(() => {
158	    if (currentIndex < captures.length - 1) selectCapture(captures[currentIndex + 1].id)
159	  }, [currentIndex, captures, selectCapture])
160	
161	  // Keyboard navigation
162	  useEffect(() => {
163	    const handler = (e: KeyboardEvent) => {
164	      const tag = (e.target as HTMLElement)?.tagName
165	      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
166	      if (e.key === 'ArrowLeft') goPrev()
167	      if (e.key === 'ArrowRight') goNext()
168	    }
169	    window.addEventListener('keydown', handler)
170	    return () => window.removeEventListener('keydown', handler)
171	  }, [goPrev, goNext])
172	
173	  if (!capture) {
174	    return (
175	      <main className="flex flex-1 items-center justify-center bg-canvas text-text-muted">
176	        Select a capture to view
177	      </main>
178	    )
179	  }
180	
181	  const tabs = TABS
182	
183	  let hostname = ''
184	  try {
185	    hostname = new URL(capture.url).hostname
186	  } catch {
187	    hostname = capture.url
188	  }
189	
190	  return (
191	    <main className="flex flex-1 flex-col overflow-hidden bg-canvas">
192	      {/* A) Viewer header */}
193	      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
194	        {/* Prev/Next nav */}
195	        <button
196	          onClick={goPrev}
197	          disabled={currentIndex <= 0}
198	          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-30"
199	        >
200	          <ChevronLeft className="h-4 w-4" />
201	        </button>
202	        <button
203	          onClick={goNext}
204	          disabled={currentIndex >= captures.length - 1}
205	          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary disabled:opacity-30"
206	        >
207	          <ChevronRight className="h-4 w-4" />
208	        </button>
209	
210	        {/* Title + URL + timestamp */}
211	        <div className="min-w-0 flex-1">
212	          <h2 className="truncate font-display text-sm font-bold text-text-primary">
213	            {capture.title || hostname}
214	          </h2>
215	          <div className="flex items-center gap-2">
216	            <span className="truncate font-mono text-[11px] text-text-muted">{capture.url}</span>
217	            <span className="shrink-0 text-[11px] text-text-faint">
218	              {formatViewerTimestamp(capture.timestamp)}
219	            </span>
220	          </div>
221	        </div>
222	
223	        {/* Right side actions */}
224	        <div className="flex items-center gap-1">
225	          <ProvenanceBadge captureId={capture.id} />
226	          <button
227	            data-testid="add-note-button"
228	            onClick={() => setShowAddNote(true)}
229	            title="Add note"
230	            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
231	          >
232	            <StickyNote className="h-3.5 w-3.5" />
233	          </button>
234	          <button
235	            onClick={handleDownload}
236	            title="Download capture"
237	            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
238	          >
239	            <Download className="h-3.5 w-3.5" />
240	          </button>
241	          <button
242	            onClick={handleOpenExternal}
243	            title="Open URL in browser"
244	            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-secondary"
245	          >
246	            <ExternalLink className="h-3.5 w-3.5" />
247	          </button>
248	          <button
249	            onClick={() => setShowDeleteConfirm(true)}
250	            title="Delete capture"
251	            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-red-400"
252	          >
253	            <Trash2 className="h-3.5 w-3.5" />
254	          </button>
255	        </div>
256	      </div>
257	
258	      {/* B) Content area */}
259	      <div className="flex-1 overflow-auto p-4">
260	        {activeTab === 'screenshot' &&
261	          (content ? (
262	            <div className="neu-card rounded-2xl overflow-hidden">
263	              {/* Fake browser chrome */}
264	              <div className="flex items-center gap-2 border-b border-border bg-elevated px-3 py-2">
265	                <div className="flex gap-1.5">
266	                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
267	                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
268	                  <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
269	                </div>
270	                <div className="flex-1 rounded-md bg-surface px-3 py-0.5 text-[11px] font-mono text-text-muted truncate">
271	                  {capture.url}
272	                </div>
273	              </div>
274	              <img src={`data:image/png;base64,${content}`} alt="Screenshot" className="w-full" />
275	            </div>
276	          ) : (
277	            <div className="text-text-muted">No screenshot available</div>
278	          ))}
279	        {activeTab === 'page' && capture.format === 'mhtml' ? (
280	          <div className="h-full w-full rounded-xl border border-border bg-white overflow-hidden">
281	            <MhtmlViewer captureId={capture.id} />
282	          </div>
283	        ) : activeTab === 'page' ? (
284	          content ? (
285	            <iframe
286	              sandbox="allow-same-origin"
287	              srcDoc={content}
288	              className="h-full w-full rounded-xl border border-border bg-white"
289	              style={{ minHeight: '500px' }}
290	              title="Archived page"
291	            />
292	          ) : (
293	            <div className="text-text-muted">No HTML available</div>
294	          )
295	        ) : null}
296	        {activeTab === 'source' &&
297	          (content ? (
298	            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-muted">
299	              {content}
300	            </pre>
301	          ) : (
302	            <div className="text-text-muted">No HTML available</div>
303	          ))}
304	        {activeTab === 'text' &&
305	          (content ? (
306	            <pre className="whitespace-pre-wrap font-mono text-sm text-text-muted">{content}</pre>
307	          ) : (
308	            <div className="text-text-muted">No text content available</div>
309	          ))}
310	        {activeTab === 'metadata' && (
311	          <div className="space-y-3 font-mono text-sm">
312	            <MetadataRow label="URL" value={capture.url} />
313	            <MetadataRow label="Timestamp" value={new Date(capture.timestamp).toLocaleString()} />
314	            <MetadataRow label="Hash (SHA-256)" value={capture.hash} />
315	            <MetadataRow label="Created" value={new Date(capture.createdAt).toLocaleString()} />
316	            {capture.headers && (
317	              <div>
318	                <div className="text-text-muted">Headers</div>
319	                <pre className="mt-1 whitespace-pre-wrap text-xs text-text-muted">
320	                  {capture.headers}
321	                </pre>
322	              </div>
323	            )}
324	          </div>
325	        )}
326	      </div>
327	
328	      {/* C) Bottom panel */}
329	      <div className="border-t border-border bg-surface">
330	        {/* Sub-tabs row */}
331	        <div className="flex items-center gap-1 border-b border-border px-3">
332	          {tabs.map((tab) => {
333	            const Icon = TAB_ICONS[tab]
334	            const isActive = activeTab === tab
335	            return (
336	              <button
337	                key={tab}
338	                onClick={() => setActiveTab(tab)}
339	                className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors ${
340	                  isActive ? 'text-accent' : 'text-text-muted hover:text-text-secondary'
341	                }`}
342	              >
343	                <Icon className="h-3.5 w-3.5" />
344	                {TAB_LABELS[tab]}
345	                {isActive && (
346	                  <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
347	                )}
348	              </button>
349	            )
350	          })}
351	        </div>
352	
353	        {/* Tag bar */}
354	        <div className="flex items-center gap-2 px-3 py-2">
355	          <TagIcon className="h-3.5 w-3.5 text-text-faint" />
356	          {captureTags.map((tag) => (
357	            <TagBadge key={tag.id} tag={tag} onClick={() => handleToggleTag(tag.id)} removable />
358	          ))}
359	          <div className="relative">
360	            <button
361	              onClick={() => setShowTagMenu(!showTagMenu)}
362	              className="flex items-center gap-1 rounded-lg border border-dashed border-border-strong px-2 py-1 text-[11px] text-text-muted hover:border-accent/30 hover:text-text-muted"
363	            >
364	              <Plus className="h-3 w-3" />
365	              Add tag
366	            </button>
367	            {showTagMenu && (
368	              <>
369	                <div className="fixed inset-0 z-40" onClick={() => setShowTagMenu(false)} />
370	                <div className="absolute bottom-full left-0 z-50 mb-1 rounded-lg border border-border bg-elevated py-1 shadow-lg">
371	                  {allTags
372	                    .filter((t) => !captureTags.some((ct) => ct.id === t.id))
373	                    .map((tag) => (
374	                      <button
375	                        key={tag.id}
376	                        onClick={() => {
377	                          handleToggleTag(tag.id)
378	                          setShowTagMenu(false)
379	                        }}
380	                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-text-secondary hover:bg-elevated"
381	                      >
382	                        <span
383	                          className="h-2 w-2 rounded-full"
384	                          style={{ backgroundColor: tag.color || '#f59e0b' }}
385	                        />
386	                        {tag.name}
387	                      </button>
388	                    ))}
389	                  {allTags.filter((t) => !captureTags.some((ct) => ct.id === t.id)).length ===
390	                    0 && <div className="px-3 py-1 text-xs text-text-muted">No more tags</div>}
391	                </div>
392	              </>
393	            )}
394	          </div>
395	
396	          {/* Spacer */}
397	          <div className="flex-1" />
398	
399	          {/* Capture position + keyboard hints */}
400	          <span className="text-[11px] text-text-faint">
401	            {currentIndex + 1} / {captures.length}
402	          </span>
403	          <span className="text-[11px] text-text-faint">← →</span>
404	        </div>
405	      </div>
406	
407	      {showDeleteConfirm && (
408	        <div
409	          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
410	          onClick={() => setShowDeleteConfirm(false)}
411	        >
412	          <div className="neu-card w-80 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
413	            <h3 className="mb-2 text-sm font-semibold text-text-primary">Delete Capture?</h3>
414	            <p className="mb-4 text-xs text-text-muted">
415	              This will permanently remove the capture and its files. This cannot be undone.
416	            </p>
417	            <div className="flex justify-end gap-2">
418	              <button
419	                onClick={() => setShowDeleteConfirm(false)}
420	                className="rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
421	              >
422	                Cancel
423	              </button>
424	              <button
425	                onClick={handleDelete}
426	                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
427	              >
428	                Delete
429	              </button>
430	            </div>
431	          </div>
432	        </div>
433	      )}
434	      <AddNoteModal
435	        open={showAddNote}
436	        caseId={caseId}
437	        captureId={capture.id}
438	        captureTitle={capture.title || ''}
439	        captureUrl={capture.url}
440	        onClose={() => setShowAddNote(false)}
441	      />
442	    </main>
443	  )
444	}
445	
446	function MetadataRow({ label, value }: { label: string; value: string }) {
447	  return (
448	    <div>
449	      <div className="text-text-muted">{label}</div>
450	      <div className="break-all text-text-secondary">{value}</div>
451	    </div>
452	  )
453	}
454	
```

**Tool Call: Find `E:\dev\birdbrain` `src/renderer/components/captures/*.tsx`**
Status: Completed

src\renderer\components\captures\CaptureItem.tsx
src\renderer\components\captures\CaptureList.tsx
src\renderer\components\captures\CaptureViewer.tsx
src\renderer\components\captures\MhtmlViewer.tsx
src\renderer\components\captures\ProvenanceBadge.tsx

## Assistant

Now let me also look at the screenshots you provided and check the parent route layout.

**Tool Call: Read src\renderer\routes\cases\$caseId\captures.tsx**
Status: Completed

```
1	import { useParams } from '@tanstack/react-router'
2	import { CaptureList } from '@renderer/components/captures/CaptureList'
3	import { CaptureViewer } from '@renderer/components/captures/CaptureViewer'
4	
5	export function CapturesRoute() {
6	  const { caseId } = useParams({ from: '/cases/$caseId/captures' })
7	
8	  return (
9	    <div className="flex flex-1 overflow-hidden">
10	      <div className="w-[30%] overflow-y-auto">
11	        <CaptureList caseId={caseId} />
12	      </div>
13	      <div className="flex-1 overflow-y-auto">
14	        <CaptureViewer />
15	      </div>
16	    </div>
17	  )
18	}
19	
```

**Tool Call: Read src\renderer\components\captures\MhtmlViewer.tsx**
Status: Completed

```
1	import { useEffect, useRef, useState } from 'react'
2	
3	interface Props {
4	  captureId: string
5	}
6	
7	// Renders MHTML via an Electron <webview> with JavaScript disabled.
8	export function MhtmlViewer({ captureId }: Props) {
9	  const [fileUrl, setFileUrl] = useState<string | null>(null)
10	  const [error, setError] = useState<string | null>(null)
11	  const ref = useRef<HTMLElement | null>(null)
12	
13	  useEffect(() => {
14	    setError(null)
15	    setFileUrl(null)
16	    window.birdbrain.captures
17	      .getMhtmlUrl(captureId)
18	      .then((url) => {
19	        if (!url) setError('MHTML file not found on disk')
20	        else setFileUrl(url)
21	      })
22	      .catch((e) => setError(String(e)))
23	  }, [captureId])
24	
25	  useEffect(() => {
26	    const wv = ref.current as Electron.WebviewTag | null
27	    if (!wv) return
28	    const blockNav = (e: Event) => e.preventDefault()
29	    wv.addEventListener('will-navigate', blockNav)
30	    wv.addEventListener('new-window', blockNav)
31	    return () => {
32	      wv.removeEventListener('will-navigate', blockNav)
33	      wv.removeEventListener('new-window', blockNav)
34	    }
35	  }, [fileUrl])
36	
37	  if (error) {
38	    return <div className="p-4 text-sm text-red-400">{error}</div>
39	  }
40	  if (!fileUrl) {
41	    return <div className="p-4 text-text-muted">Loading MHTML...</div>
42	  }
43	
44	  return (
45	    <webview
46	      ref={ref as unknown as React.RefObject<HTMLElement>}
47	      src={fileUrl}
48	      nodeintegration="false"
49	      allowpopups="false"
50	      webpreferences="javascript=no,contextIsolation=yes,sandbox=yes"
51	      style={{ width: '100%', height: '100%', minHeight: '500px', background: 'white' }}
52	    />
53	  )
54	}
55	
```

## Assistant

I can see the issues from the screenshots and code. The current layout has:

1. **Header** (top) — nav arrows, title, URL, action buttons
2. **Content area** (middle, flex-1) — the iframe/webview/screenshot fills available space
3. **Bottom panel** — sub-tabs (Screenshot, Page, Source, Text, Metadata) + tag bar anchored to the bottom

The problem: the sub-tabs are at the bottom, disconnected from the content they control, and when the window resizes the content area collapses awkwardly while the bottom panel stays fixed.

Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)

## User

yes

## Assistant

<thinking>
The user wants to use the visual companion. Let me read the visual companion guide first.
</thinking>

**Tool Call: Read C:\Users\mattd\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.7\skills\brainstorming\visual-companion.md**
Status: Completed

```
1	# Visual Companion Guide
2	
3	Browser-based visual brainstorming companion for showing mockups, diagrams, and options.
4	
5	## When to Use
6	
7	Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**
8	
9	**Use the browser** when the content itself is visual:
10	
11	- **UI mockups** — wireframes, layouts, navigation structures, component designs
12	- **Architecture diagrams** — system components, data flow, relationship maps
13	- **Side-by-side visual comparisons** — comparing two layouts, two color schemes, two design directions
14	- **Design polish** — when the question is about look and feel, spacing, visual hierarchy
15	- **Spatial relationships** — state machines, flowcharts, entity relationships rendered as diagrams
16	
17	**Use the terminal** when the content is text or tabular:
18	
19	- **Requirements and scope questions** — "what does X mean?", "which features are in scope?"
20	- **Conceptual A/B/C choices** — picking between approaches described in words
21	- **Tradeoff lists** — pros/cons, comparison tables
22	- **Technical decisions** — API design, data modeling, architectural approach selection
23	- **Clarifying questions** — anything where the answer is words, not a visual preference
24	
25	A question *about* a UI topic is not automatically a visual question. "What kind of wizard do you want?" is conceptual — use the terminal. "Which of these wizard layouts feels right?" is visual — use the browser.
26	
27	## How It Works
28	
29	The server watches a directory for HTML files and serves the newest one to the browser. You write HTML content to `screen_dir`, the user sees it in their browser and can click to select options. Selections are recorded to `state_dir/events` that you read on your next turn.
30	
31	**Content fragments vs full documents:** If your HTML file starts with `<!DOCTYPE` or `<html`, the server serves it as-is (just injects the helper script). Otherwise, the server automatically wraps your content in the frame template — adding the header, CSS theme, selection indicator, and all interactive infrastructure. **Write content fragments by default.** Only write full documents when you need complete control over the page.
32	
33	## Starting a Session
34	
35	```bash
36	# Start server with persistence (mockups saved to project)
37	scripts/start-server.sh --project-dir /path/to/project
38	
39	# Returns: {"type":"server-started","port":52341,"url":"http://localhost:52341",
40	#           "screen_dir":"/path/to/project/.superpowers/brainstorm/12345-1706000000/content",
41	#           "state_dir":"/path/to/project/.superpowers/brainstorm/12345-1706000000/state"}
42	```
43	
44	Save `screen_dir` and `state_dir` from the response. Tell user to open the URL.
45	
46	**Finding connection info:** The server writes its startup JSON to `$STATE_DIR/server-info`. If you launched the server in the background and didn't capture stdout, read that file to get the URL and port. When using `--project-dir`, check `<project>/.superpowers/brainstorm/` for the session directory.
47	
48	**Note:** Pass the project root as `--project-dir` so mockups persist in `.superpowers/brainstorm/` and survive server restarts. Without it, files go to `/tmp` and get cleaned up. Remind the user to add `.superpowers/` to `.gitignore` if it's not already there.
49	
50	**Launching the server by platform:**
51	
52	**Claude Code (macOS / Linux):**
53	```bash
54	# Default mode works — the script backgrounds the server itself
55	scripts/start-server.sh --project-dir /path/to/project
56	```
57	
58	**Claude Code (Windows):**
59	```bash
60	# Windows auto-detects and uses foreground mode, which blocks the tool call.
61	# Use run_in_background: true on the Bash tool call so the server survives
62	# across conversation turns.
63	scripts/start-server.sh --project-dir /path/to/project
64	```
65	When calling this via the Bash tool, set `run_in_background: true`. Then read `$STATE_DIR/server-info` on the next turn to get the URL and port.
66	
67	**Codex:**
68	```bash
69	# Codex reaps background processes. The script auto-detects CODEX_CI and
70	# switches to foreground mode. Run it normally — no extra flags needed.
71	scripts/start-server.sh --project-dir /path/to/project
72	```
73	
74	**Gemini CLI:**
75	```bash
76	# Use --foreground and set is_background: true on your shell tool call
77	# so the process survives across turns
78	scripts/start-server.sh --project-dir /path/to/project --foreground
79	```
80	
81	**Other environments:** The server must keep running in the background across conversation turns. If your environment reaps detached processes, use `--foreground` and launch the command with your platform's background execution mechanism.
82	
83	If the URL is unreachable from your browser (common in remote/containerized setups), bind a non-loopback host:
84	
85	```bash
86	scripts/start-server.sh \
87	  --project-dir /path/to/project \
88	  --host 0.0.0.0 \
89	  --url-host localhost
90	```
91	
92	Use `--url-host` to control what hostname is printed in the returned URL JSON.
93	
94	## The Loop
95	
96	1. **Check server is alive**, then **write HTML** to a new file in `screen_dir`:
97	   - Before each write, check that `$STATE_DIR/server-info` exists. If it doesn't (or `$STATE_DIR/server-stopped` exists), the server has shut down — restart it with `start-server.sh` before continuing. The server auto-exits after 30 minutes of inactivity.
98	   - Use semantic filenames: `platform.html`, `visual-style.html`, `layout.html`
99	   - **Never reuse filenames** — each screen gets a fresh file
100	   - Use Write tool — **never use cat/heredoc** (dumps noise into terminal)
101	   - Server automatically serves the newest file
102	
103	2. **Tell user what to expect and end your turn:**
104	   - Remind them of the URL (every step, not just first)
105	   - Give a brief text summary of what's on screen (e.g., "Showing 3 layout options for the homepage")
106	   - Ask them to respond in the terminal: "Take a look and let me know what you think. Click to select an option if you'd like."
107	
108	3. **On your next turn** — after the user responds in the terminal:
109	   - Read `$STATE_DIR/events` if it exists — this contains the user's browser interactions (clicks, selections) as JSON lines
110	   - Merge with the user's terminal text to get the full picture
111	   - The terminal message is the primary feedback; `state_dir/events` provides structured interaction data
112	
113	4. **Iterate or advance** — if feedback changes current screen, write a new file (e.g., `layout-v2.html`). Only move to the next question when the current step is validated.
114	
115	5. **Unload when returning to terminal** — when the next step doesn't need the browser (e.g., a clarifying question, a tradeoff discussion), push a waiting screen to clear the stale content:
116	
117	   ```html
118	   <!-- filename: waiting.html (or waiting-2.html, etc.) -->
119	   <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
120	     <p class="subtitle">Continuing in terminal...</p>
121	   </div>
122	   ```
123	
124	   This prevents the user from staring at a resolved choice while the conversation has moved on. When the next visual question comes up, push a new content file as usual.
125	
126	6. Repeat until done.
127	
128	## Writing Content Fragments
129	
130	Write just the content that goes inside the page. The server wraps it in the frame template automatically (header, theme CSS, selection indicator, and all interactive infrastructure).
131	
132	**Minimal example:**
133	
134	```html
135	<h2>Which layout works better?</h2>
136	<p class="subtitle">Consider readability and visual hierarchy</p>
137	
138	<div class="options">
139	  <div class="option" data-choice="a" onclick="toggleSelect(this)">
140	    <div class="letter">A</div>
141	    <div class="content">
142	      <h3>Single Column</h3>
143	      <p>Clean, focused reading experience</p>
144	    </div>
145	  </div>
146	  <div class="option" data-choice="b" onclick="toggleSelect(this)">
147	    <div class="letter">B</div>
148	    <div class="content">
149	      <h3>Two Column</h3>
150	      <p>Sidebar navigation with main content</p>
151	    </div>
152	  </div>
153	</div>
154	```
155	
156	That's it. No `<html>`, no CSS, no `<script>` tags needed. The server provides all of that.
157	
158	## CSS Classes Available
159	
160	The frame template provides these CSS classes for your content:
161	
162	### Options (A/B/C choices)
163	
164	```html
165	<div class="options">
166	  <div class="option" data-choice="a" onclick="toggleSelect(this)">
167	    <div class="letter">A</div>
168	    <div class="content">
169	      <h3>Title</h3>
170	      <p>Description</p>
171	    </div>
172	  </div>
173	</div>
174	```
175	
176	**Multi-select:** Add `data-multiselect` to the container to let users select multiple options. Each click toggles the item. The indicator bar shows the count.
177	
178	```html
179	<div class="options" data-multiselect>
180	  <!-- same option markup — users can select/deselect multiple -->
181	</div>
182	```
183	
184	### Cards (visual designs)
185	
186	```html
187	<div class="cards">
188	  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
189	    <div class="card-image"><!-- mockup content --></div>
190	    <div class="card-body">
191	      <h3>Name</h3>
192	      <p>Description</p>
193	    </div>
194	  </div>
195	</div>
196	```
197	
198	### Mockup container
199	
200	```html
201	<div class="mockup">
202	  <div class="mockup-header">Preview: Dashboard Layout</div>
203	  <div class="mockup-body"><!-- your mockup HTML --></div>
204	</div>
205	```
206	
207	### Split view (side-by-side)
208	
209	```html
210	<div class="split">
211	  <div class="mockup"><!-- left --></div>
212	  <div class="mockup"><!-- right --></div>
213	</div>
214	```
215	
216	### Pros/Cons
217	
218	```html
219	<div class="pros-cons">
220	  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
221	  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
222	</div>
223	```
224	
225	### Mock elements (wireframe building blocks)
226	
227	```html
228	<div class="mock-nav">Logo | Home | About | Contact</div>
229	<div style="display: flex;">
230	  <div class="mock-sidebar">Navigation</div>
231	  <div class="mock-content">Main content area</div>
232	</div>
233	<button class="mock-button">Action Button</button>
234	<input class="mock-input" placeholder="Input field">
235	<div class="placeholder">Placeholder area</div>
236	```
237	
238	### Typography and sections
239	
240	- `h2` — page title
241	- `h3` — section heading
242	- `.subtitle` — secondary text below title
243	- `.section` — content block with bottom margin
244	- `.label` — small uppercase label text
245	
246	## Browser Events Format
247	
248	When the user clicks options in the browser, their interactions are recorded to `$STATE_DIR/events` (one JSON object per line). The file is cleared automatically when you push a new screen.
249	
250	```jsonl
251	{"type":"click","choice":"a","text":"Option A - Simple Layout","timestamp":1706000101}
252	{"type":"click","choice":"c","text":"Option C - Complex Grid","timestamp":1706000108}
253	{"type":"click","choice":"b","text":"Option B - Hybrid","timestamp":1706000115}
254	```
255	
256	The full event stream shows the user's exploration path — they may click multiple options before settling. The last `choice` event is typically the final selection, but the pattern of clicks can reveal hesitation or preferences worth asking about.
257	
258	If `$STATE_DIR/events` doesn't exist, the user didn't interact with the browser — use only their terminal text.
259	
260	## Design Tips
261	
262	- **Scale fidelity to the question** — wireframes for layout, polish for polish questions
263	- **Explain the question on each page** — "Which layout feels more professional?" not just "Pick one"
264	- **Iterate before advancing** — if feedback changes current screen, write a new version
265	- **2-4 options max** per screen
266	- **Use real content when it matters** — for a photography portfolio, use actual images (Unsplash). Placeholder content obscures design issues.
267	- **Keep mockups simple** — focus on layout and structure, not pixel-perfect design
268	
269	## File Naming
270	
271	- Use semantic names: `platform.html`, `visual-style.html`, `layout.html`
272	- Never reuse filenames — each screen must be a new file
273	- For iterations: append version suffix like `layout-v2.html`, `layout-v3.html`
274	- Server serves newest file by modification time
275	
276	## Cleaning Up
277	
278	```bash
279	scripts/stop-server.sh $SESSION_DIR
280	```
281	
282	If the session used `--project-dir`, mockup files persist in `.superpowers/brainstorm/` for later reference. Only `/tmp` sessions get deleted on stop.
283	
284	## Reference
285	
286	- Frame template (CSS reference): `scripts/frame-template.html`
287	- Helper script (client-side): `scripts/helper.js`
288	
```

**Tool Call: bash "C:\Users\mattd\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.7\scripts\start-server.sh" --project-dir "E:\dev\birdbrain"**
Status: Completed

Terminal:
```
Command running in background with ID: bv6xhijgp. Output is being written to: C:\Users\mattd\AppData\Local\Temp\claude\E--dev-birdbrain\9b3e23eb-dfa7-4821-adba-956bea4dceb0\tasks\bv6xhijgp.output




```


**Tool Call: ls E:/dev/birdbrain/.superpowers/brainstorm/**
Status: Completed

Terminal:
```
1434-1775517248
315-1775524370
957-1774766632



```


**Tool Call: cat E:/dev/birdbrain/.superpowers/brainstorm/315-1775524370/state/server-info 2>/dev/null || echo "not ready yet"**
Status: Completed

Terminal:
```
not ready yet





```


**Tool Call: sleep 2 && ls E:/dev/birdbrain/.superpowers/brainstorm/ && for d in E:/dev/birdbrain/.superpowers/brainstorm/*/state/server-info; do echo "=== $d ==="; cat "$d" 2>/dev/null; done**
Status: Failed

```
Exit code 1
1434-1775517248
315-1775524370
957-1774766632
=== E:/dev/birdbrain/.superpowers/brainstorm/*/state/server-info ===
```

**Tool Call: ls -la E:/dev/birdbrain/.superpowers/brainstorm/315-1775524370/state/**
Status: Completed

Terminal:
```
total 2
drwxr-xr-x 1 mattd 197121  0 Apr  6 19:49 .
drwxr-xr-x 1 mattd 197121  0 Apr  6 18:12 ..
-rw-r--r-- 1 mattd 197121 52 Apr  6 19:49 server-stopped
-rw-r--r-- 1 mattd 197121  4 Apr  6 18:12 server.pid

```


## Assistant

The previous session stopped. Let me check the background task output and find the new session.

**Tool Call: sleep 3 && ls -lt E:/dev/birdbrain/.superpowers/brainstorm/**
Status: Completed

Terminal:
```
total 0
drwxr-xr-x 1 mattd 197121 0 Apr  6 18:12 315-1775524370
drwxr-xr-x 1 mattd 197121 0 Apr  6 16:14 1434-1775517248
drwxr-xr-x 1 mattd 197121 0 Mar 28 23:43 957-1774766632


```


**Tool Call: Read C:\Users\mattd\AppData\Local\Temp\claude\E--dev-birdbrain\9b3e23eb-dfa7-4821-adba-956bea4dceb0\tasks\bv6xhijgp.output**
Status: Completed

```
1	bash: C:\Users\mattd\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.7\scripts\start-server.sh: No such file or directory
2	
```

**Tool Call: ls "C:/Users/mattd/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/scripts/"**
Status: Completed

Terminal:
```
bump-version.sh





```


**Tool Call: Find `C:\Users\mattd\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.7` `**/*start-server*`**
Status: Completed

C:\Users\mattd\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.7\skills\brainstorming\scripts\start-server.sh

**Tool Call: bash "C:/Users/mattd/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/scripts/start-server.sh" --project-dir "E:/dev/birdbrain"**
Status: Completed

Terminal:
```
Command running in background with ID: bblwqkgyu. Output is being written to: C:\Users\mattd\AppData\Local\Temp\claude\E--dev-birdbrain\9b3e23eb-dfa7-4821-adba-956bea4dceb0\tasks\bblwqkgyu.output




```


**Tool Call: sleep 3 && ls -lt E:/dev/birdbrain/.superpowers/brainstorm/**
Status: Completed

Terminal:
```
total 0
drwxr-xr-x 1 mattd 197121 0 Apr  6 20:43 1203-1775533418
drwxr-xr-x 1 mattd 197121 0 Apr  6 18:12 315-1775524370
drwxr-xr-x 1 mattd 197121 0 Apr  6 16:14 1434-1775517248
drwxr-xr-x 1 mattd 197121 0 Mar 28 23:43 957-1774766632

```


**Tool Call: cat E:/dev/birdbrain/.superpowers/brainstorm/1203-1775533418/state/server-info**
Status: Completed

Terminal:
```
{"type":"server-started","port":49559,"host":"127.0.0.1","url_host":"localhost","url":"http://localhost:49559","screen_dir":"E:\\dev\\birdbrain\\.superpowers\\brainstorm\\1203-1775533418\\content","state_dir":"E:\\dev\\birdbrain\\.superpowers\\brainstorm\\1203-1775533418\\state"}



```


## Assistant

Visual companion is running. Open **http://localhost:49559** in your browser.

Now let me push the first visual — a side-by-side comparison of the current layout vs proposed approaches.

**Tool Call: Write .superpowers\\brainstorm\\1203\-1775533418\\content\\current\-vs\-proposed.html**
Status: Completed

Diff: E:\dev\birdbrain\.superpowers\brainstorm\1203-1775533418\content\current-vs-proposed.html
```
<h2>Capture Viewer Layout — Current Problem</h2>
<p class="subtitle">The sub-tabs (Screenshot, Page, Source, Text, Metadata) are anchored to the bottom, disconnected from the content they control. On resize, the layout breaks.</p>

<div class="section">
  <h3>Current Layout (broken)</h3>
  <div class="mockup">
    <div class="mockup-header">CaptureViewer — Current Structure</div>
    <div class="mockup-body" style="padding:0;font-family:system-ui;font-size:13px;">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #333;background:#1a1a2e;">
        <span style="color:#666;">◀ ▶</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:#e0e0e0;font-size:13px;">Page Title</div>
          <div style="font-size:10px;color:#888;font-family:monospace;">https://example.com/page</div>
        </div>
        <span style="color:#666;font-size:11px;">📝 ⬇ 🔗 🗑</span>
      </div>
      <!-- Content fills middle -->
      <div style="height:200px;display:flex;align-items:center;justify-content:center;background:#0d0d1a;color:#555;font-size:12px;">
        Content area (iframe / screenshot / source)<br>
        <span style="color:#f44;font-size:11px;">↕ resizes unpredictably</span>
      </div>
      <!-- Bottom panel — THE PROBLEM -->
      <div style="border-top:1px solid #333;background:#12122a;">
        <div style="display:flex;gap:2px;padding:0 12px;border-bottom:1px solid #222;">
          <span style="padding:8px 12px;font-size:11px;color:#7c6ef0;border-bottom:2px solid #7c6ef0;">📷 Screenshot</span>
          <span style="padding:8px 12px;font-size:11px;color:#888;">🌐 Page</span>
          <span style="padding:8px 12px;font-size:11px;color:#888;">💻 Source</span>
          <span style="padding:8px 12px;font-size:11px;color:#888;">📄 Text</span>
          <span style="padding:8px 12px;font-size:11px;color:#888;">ℹ Metadata</span>
        </div>
        <div style="display:flex;align-items:center;padding:6px 12px;gap:8px;font-size:11px;color:#888;">
          🏷 <span style="background:#333;padding:2px 8px;border-radius:4px;font-size:10px;">tag1</span>
          <span style="border:1px dashed #444;padding:2px 8px;border-radius:4px;font-size:10px;">+ Add tag</span>
          <span style="flex:1;"></span>
          <span>3 / 12</span>
          <span>← →</span>
        </div>
      </div>
    </div>
  </div>
  <div style="margin-top:12px;padding:12px 16px;background:rgba(244,68,68,0.08);border:1px solid rgba(244,68,68,0.2);border-radius:8px;font-size:13px;color:#f88;">
    <strong>Problems:</strong> Tabs at bottom feel disconnected from content. Tag bar + tabs + status all crammed together. On resize, content area collapses but bottom panel stays fixed. Sub-tabs should control what's above them, not sit below it.
  </div>
</div>

<h3 style="margin-top:32px;">Which layout direction appeals to you?</h3>
<p class="subtitle">Click to select — we'll refine the winner in the next step.</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Tabs at Top of Content</h3>
      <p>Move sub-tabs directly above the content area (below the header). Tags move to the header or a collapsible section. Clean vertical flow: Header → Tabs → Content.</p>
    </div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content">
      <h3>Tabs Integrated into Header</h3>
      <p>Merge sub-tabs into the header bar itself (second row or inline). Maximizes content area by eliminating the bottom panel entirely. Tags become a dropdown/popover.</p>
    </div>
  </div>
  <div class="option" data-choice="c" onclick="toggleSelect(this)">
    <div class="letter">C</div>
    <div class="content">
      <h3>Sidebar Tabs (Vertical)</h3>
      <p>Icon-only vertical tab strip on the left edge of the viewer. Content fills the remaining space. Tags stay in a slim footer. IDE-style layout.</p>
    </div>
  </div>
</div>

```


## Assistant

I've put up a visual showing the current broken layout and 3 directional options at **http://localhost:49559**. Take a look and click the one that appeals to you most:

- **A) Tabs at Top of Content** — move sub-tabs above the content, below the header
- **B) Tabs Integrated into Header** — merge tabs into the header bar, eliminate bottom panel
- **C) Sidebar Tabs (Vertical)** — icon-only vertical tab strip on the left edge, IDE-style

Let me know which direction you like (or click to select in the browser).

## User

<task-notification>
<task-id>bv6xhijgp</task-id>
<tool-use-id>toolu_01E7Wxzi3vNADJBstkRLs8vk</tool-use-id>
<output-file>C:\Users\mattd\AppData\Local\Temp\claude\E--dev-birdbrain\9b3e23eb-dfa7-4821-adba-956bea4dceb0\tasks\bv6xhijgp.output</output-file>
<status>failed</status>
<summary>Background command "Start visual companion server" failed with exit code 127</summary>
</task-notification>

## Assistant

The first server attempt failed (wrong path), but the second one succeeded — we're good. The companion is running at **http://localhost:49559**.

Waiting for your pick from the 3 layout options.
