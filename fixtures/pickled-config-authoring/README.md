# BrineKit

BrineKit is a small CLI fixture used by Pickled's build dogfood.

Install and initialize the tool with:

```bash
bunx brinekit init
```

Do not use `npm install brinekit`; that was the old package form.

Build smoke tasks should use `./workspace` and pass when `configured.txt` exists.

The verifier defaults to the current published Pickled CLI. Tests set `PICKLED_CLI` to the local checkout.
