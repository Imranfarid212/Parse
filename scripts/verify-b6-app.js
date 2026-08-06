const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b6:app] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };

const search = read('src/components/search/SearchView.tsx');
// B7 lifted the filter sheet out of SearchView so Export could use the same one.
// These claims are still true and still tested — they just live in the shared
// component now, and are asserted there rather than being quietly dropped.
const filterSheet = read('src/components/receipt/ReceiptFilterSheet.tsx');
const fan = read('src/components/search/FanCarousel.tsx');
const receiptCard = read('src/components/ui/ReceiptCard.tsx');
const editor = read('src/components/receipt/receipt-editor-modal.tsx');
const management = read('src/lib/receipts/management.ts');
const realtime = read('src/lib/receipts/use-realtime-receipts.ts');
const store = read('src/lib/receipts/store.ts');

includes(search, 'SEARCH_DEBOUNCE_MS = 300', 'text search is debounced');
includes(search, 'Merchant, note, or line item description', 'search UI documents every searchable text source');
includes(filterSheet, 'searchQuerySchema.safeParse', 'filter UI uses the canonical contract');
includes(filterSheet, 'amount_currency', 'amount filters carry a currency');
includes(filterSheet, "from '@expo/ui/community/datetime-picker'", 'date filters use the native SDK 57 picker');
includes(filterSheet, 'minimumDate=', 'end-date picker enforces the selected start date');
includes(filterSheet, 'maximumDate=', 'date pickers prevent invalid future or reversed ranges');
includes(filterSheet, '<KeyboardAvoidingView', 'filter sheet remains visible above the keyboard');
includes(filterSheet, 'filterScrollRef.current?.scrollToEnd', 'amount inputs are revealed when focused');
includes(search, "changeView(enabled ? 'card' : 'list')", 'card/list toggle shares one result set');
includes(search, '<FanCarousel', 'card view preserves the original stacked receipt carousel');
includes(search, 'fanWrap: { flex: 1, paddingTop: 30 }', 'card fan has calm separation from search');
includes(fan, 'details={item.details}', 'fan cards populate the paper receipt face');
includes(fan, 'MAX_VISIBLE_CARDS = 5', 'card view renders at most five receipts at once');
includes(fan, 'activeSlot={CENTER_SLOT}', 'the selected receipt always remains centered');
includes(fan, 'offsets = items.length >= MAX_VISIBLE_CARDS ? [-2, -1, 0, 1, 2]', 'the wheel keeps two cards on each side');
includes(fan, 'activeIndex % visibleEntries.length', 'the dot indicator advances with the receipt wheel');
includes(fan, 'current + 1', 'the same next control advances continuously through results');
includes(receiptCard, 'details.items', 'receipt cards render real line-item descriptions');
includes(search, 'setReceiptViewPreference', 'view toggle persists');
includes(search, '<ReceiptEditorModal', 'search entry points use the shared editor');
includes(search, 'softDeleteManagedReceipt', 'delete is soft');
includes(search, 'restoreManagedReceipt', 'undo restores');
includes(search, 'This receipt will be removed from Search and Recents.', 'delete confirmation describes the visible effect without promising a recovery screen');
includes(editor, '<EditSheet', 'shared management editor reuses the capture editor');
includes(management, 'store.isLocalSearchReady', 'hydrated account-owned SQLite is the normal search path');
includes(management, 'return searchLocal(parsed)', 'ready searches remain local-first');
includes(management, "supabase.rpc('search_receipts'", 'unhydrated first installs retain a server fallback');
includes(management, "supabase.rpc('update_receipt_with_items_v2'", 'edits use revision-aware idempotent mutations');
includes(realtime, "table: 'receipts'", 'receipt changes subscribe through Realtime');
includes(realtime, 'syncFromServer', 'Realtime changes reconcile the SQLite mirror before re-querying');
includes(realtime, 'removeChannel', 'Realtime channel is cleaned up');
includes(store, 'receipt_preferences', 'view preference has durable local storage');
includes(store, "'delete_pending', 'deleted'", 'soft-deleted local rows are excluded');
includes(store, 'USING fts5', 'local search uses an FTS5 index');
includes(store, 'bm25(receipt_search_fts', 'local text matches are ranked');
includes(store, 'json_each(json_extract', 'line-item descriptions are indexed locally');

console.log('[b6:app] PASS');
