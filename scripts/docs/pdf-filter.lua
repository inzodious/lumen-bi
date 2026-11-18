--[[
Pandoc Lua filter for the PDF build (scripts/docs/build-pdf.mjs). Applied to one article at a time.

Metadata it reads (set by build-pdf.mjs with --metadata):
  article_id     id prefix of this article, e.g. "get-started--install-on-linux"
  article_dir    the article's folder relative to docs/, e.g. "get-started" ("" for docs/README.md)
  docs_root      absolute path of docs/
  edition_map    path of a JSON file: { "<path relative to docs/>": "<article id>" } for every article in the edition
  level_shift    number added to every heading level (1 for articles, 0 for section hubs)

What it does:
  - GitHub alert blockquotes (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]) become styled callouts;
  - every heading id is prefixed with the article id, so many articles can share one HTML document;
  - links to articles of the same edition become in-document links; links to other articles print their text
    followed by the article path; links to other repository files print as text; web links stay links;
  - relative image paths become absolute file:// URLs;
  - ```mermaid code blocks are dropped (the Markdown carries a text version of each diagram).
]]

local article_id = ''
local article_dir = ''
local docs_root = ''
local level_shift = 0
local edition = {}

local function read_json(path)
  local f = io.open(path, 'r')
  if not f then return {} end
  local s = f:read('a')
  f:close()
  return pandoc.json.decode(s, false) or {}
end

-- normalise "a/b/../c/./d" (no leading slash handling needed: paths are relative to docs/)
local function normalise(path)
  local out = {}
  for part in string.gmatch(path, '[^/]+') do
    if part == '..' then
      if #out > 0 and out[#out] ~= '..' then table.remove(out) else table.insert(out, '..') end
    elseif part ~= '.' and part ~= '' then
      table.insert(out, part)
    end
  end
  return table.concat(out, '/')
end

local function join(dir, rel)
  if dir == '' then return normalise(rel) end
  return normalise(dir .. '/' .. rel)
end

local function url_decode(s)
  return (s:gsub('%%(%x%x)', function(h) return string.char(tonumber(h, 16)) end))
end

function Meta(m)
  article_id = pandoc.utils.stringify(m.article_id or '')
  article_dir = pandoc.utils.stringify(m.article_dir or '')
  docs_root = pandoc.utils.stringify(m.docs_root or '')
  level_shift = tonumber(pandoc.utils.stringify(m.level_shift or '0')) or 0
  local map_path = pandoc.utils.stringify(m.edition_map or '')
  if map_path ~= '' then edition = read_json(map_path) end
  return m
end

local KINDS = { NOTE = 'Note', TIP = 'Tip', IMPORTANT = 'Important', WARNING = 'Warning', CAUTION = 'Caution' }

function BlockQuote(bq)
  local first = bq.content[1]
  if not first or (first.t ~= 'Para' and first.t ~= 'Plain') then return nil end
  local head = first.content[1]
  if not head or head.t ~= 'Str' then return nil end
  local kind = head.text:match('^%[!(%u+)%]$')
  if not kind or not KINDS[kind] then return nil end
  -- drop the marker and the line break after it
  local rest = pandoc.List()
  for i = 2, #first.content do rest:insert(first.content[i]) end
  while #rest > 0 and (rest[1].t == 'SoftBreak' or rest[1].t == 'LineBreak' or rest[1].t == 'Space') do rest:remove(1) end
  local blocks = pandoc.List()
  blocks:insert(pandoc.Para({ pandoc.Strong({ pandoc.Str(KINDS[kind]) }) }, { class = 'callout-title' }))
  if #rest > 0 then blocks:insert(pandoc.Para(rest)) end
  for i = 2, #bq.content do blocks:insert(bq.content[i]) end
  return pandoc.Div(blocks, { class = 'callout callout-' .. kind:lower() })
end

function Header(h)
  if h.identifier ~= '' then h.identifier = article_id .. '--' .. h.identifier end
  h.level = math.min(6, h.level + level_shift)
  return h
end

local function is_external(t)
  return t:match('^%a[%w+.-]*:') ~= nil
end

function Link(l)
  local target = l.target
  if is_external(target) then return nil end
  if target:sub(1, 1) == '#' then
    l.target = '#' .. article_id .. '--' .. target:sub(2)
    return l
  end
  local path, anchor = target:match('^([^#]*)#?(.*)$')
  path = url_decode(path)
  local rel = join(article_dir, path)
  if rel:match('/$') then rel = rel .. 'README.md' end
  local id = edition[rel]
  if id then
    l.target = '#' .. id .. ((anchor ~= nil and anchor ~= '') and ('--' .. anchor) or '')
    return l
  end
  if rel:match('%.md$') and not rel:match('^%.%.') then
    -- another documentation article that is not in this edition: text + its path
    local out = pandoc.List(l.content)
    out:insert(pandoc.Space())
    out:insert(pandoc.Span({ pandoc.Str('(docs/' .. rel .. ')') }, { class = 'xref' }))
    return out
  end
  -- a repository file (source, script…): plain text
  return pandoc.Span(l.content, { class = 'repo-ref' })
end

function Image(img)
  local src = img.src
  if is_external(src) or src:sub(1, 1) == '/' then return nil end
  img.src = 'file://' .. docs_root .. '/' .. join(article_dir, url_decode(src))
  return img
end

-- ```mermaid blocks: GitHub renders them; the articles follow each one with a plain-text version of the same
-- diagram, which the PDF keeps. The PDF build does not run Mermaid, so the source block is dropped.
-- Wide blocks (ASCII diagrams, long command lines) get a smaller font instead of wrapping, up to a point.
function CodeBlock(cb)
  if cb.classes:includes('mermaid') then return {} end
  local widest = 0
  for line in (cb.text .. '\n'):gmatch('([^\n]*)\n') do
    local n = utf8.len(line) or #line
    if n > widest then widest = n end
  end
  if widest > 150 then cb.classes:insert('w4')
  elseif widest > 125 then cb.classes:insert('w3')
  elseif widest > 108 then cb.classes:insert('w2')
  elseif widest > 92 then cb.classes:insert('w1') end
  return cb
end

-- Inline code in table cells: allow line breaks after / . _ - : so long paths wrap at sensible points instead of
-- forcing narrow columns to break inside words.
local function esc_html(t)
  return (t:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end
local function breakable_code(c)
  local text = esc_html(c.text)
  -- no break after a leading separator ("./x", ".pbit")
  local html = text:sub(1, 1) .. text:sub(2):gsub('([^/._:%-])([/._:%-])', '%1%2<wbr>')
  return pandoc.RawInline('html', '<code>' .. html .. '</code>')
end
function Table(t)
  return t:walk({ Code = breakable_code })
end

-- Meta must run before the other functions see any element
return {
  { Meta = Meta },
  { BlockQuote = BlockQuote, Header = Header, Link = Link, Image = Image, CodeBlock = CodeBlock, Table = Table }
}
