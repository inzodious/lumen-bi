# Third-party notices — `src/core/io/pbix/datamodel`

This directory contains TypeScript ports of, and code informed by, the following MIT-licensed
projects. No upstream source files are copied verbatim; the ports re-implement their logic.

| Upstream | Used for | Files here |
|---|---|---|
| Microsoft **Xpress9** compression library (`Xpress9DecHuffman.c`, `Xpress9DecLz77.c`, `Xpress9Lz77Dec.i`, `Xpress9Misc.c`) — Copyright (c) Microsoft Corporation, MIT — as packaged in **xpress9-python** https://github.com/Hugoberry/xpress9-python (Copyright (c) 2025 Igor Cotruta, MIT) | XPress9 decoder port | `xpress9.ts`, `container.ts` |
| Microsoft **Xpress** (XPress8) decoder from the Extensible Storage Engine https://github.com/microsoft/Extensible-Storage-Engine (`xdecode.c`, `xdecode.i`) — Copyright (c) Microsoft Corporation, MIT — as packaged in **xpress8-python** https://github.com/Hugoberry/xpress8-python (Copyright (c) 2026 Igor Cotruta, MIT) | XPress8 per-file decoder port and chunk framing | `xpress8.ts` |
| **pbixray** https://github.com/Hugoberry/pbixray — Copyright (c) 2024 Igor Cotruta, MIT | Format knowledge: ABF backup layout, DataModel container framing, Kaitai descriptions of `.idf`/`.idfmeta`/`.dictionary`, VertiPaq decoding rules, metadata.sqlitedb legacy schema names. Also the reference implementation for differential testing. | `abf.ts`, `container.ts`, `vertipaq.ts`, `columns.ts`, `metadata.ts` |
| **xmhuffman** https://github.com/Hugoberry/xmhuffman-cython — Copyright (c) 2026 Igor Cotruta, MIT | Huffman string-page decoding (canonical code construction, pair-swapped bitstream, charset modes) | `vertipaq.ts` |

The on-disk formats themselves are described in Microsoft's open specification
[MS-XLDM] (Spreadsheet Data Model File Format).

The writers in `../write/vertipaq/` and `../write/fresh/` use the same format knowledge (pbixray's field names for
`.dictionary` and `.idfmeta`). `../write/fresh/schema.ts` lists the table and column names of the `metadata.sqlitedb`
catalog as Power BI Desktop creates it: these are the Tabular Object Model rowsets documented in Microsoft's open
specification [MS-SSAS-T] plus the engine's storage tables, generated from the `CREATE TABLE` statements of a
database file. The statements describe the engine's catalog only; no data or object of any model is copied.

## Test fixtures (`__fixtures__/`)

| File | Origin | License |
|---|---|---|
| `data-profiling-demo.pbix` | "2018SU10 Data Profiling Demo - October.pbix" from https://github.com/microsoft/powerbi-desktop-samples (Monthly Desktop Blog Samples/2018), unmodified | MIT, Copyright (c) Microsoft Corporation |
| `abc-multithreaded.pbix` | `data/abc.pbix` from https://github.com/Hugoberry/pbixray, with its DataModel re-encoded as a multi-threaded XPress9 stream (using the xpress9-python encoder) | MIT, Copyright (c) 2024 Igor Cotruta |
| `*.expected.json` | Per-column SHA-1 hashes / samples of the values decoded by pbixray 0.15.5 from the fixtures above | derived data |

---

## License texts

### Microsoft Xpress9 / Xpress (XPress8) sources

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### xpress9-python

```
MIT License

Copyright (c) 2025 Igor Cotruta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### xpress8-python

```
MIT License

Copyright (c) 2026 Igor Cotruta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### pbixray

```
MIT License

Copyright (c) 2024 Igor Cotruta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### xmhuffman

```
MIT License

Copyright (c) 2026 Igor Cotruta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### microsoft/powerbi-desktop-samples (fixture `data-profiling-demo.pbix`)

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
