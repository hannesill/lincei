# lincei

Thin Python wrapper around the `lincei dataset` CLI.

```python
import lincei

df = lincei.query("select * from patients limit 10", dataset="mimic-iv-demo")
schema = lincei.schema(dataset="mimic-iv-demo")
```

`query()` imports pandas lazily. Install the optional pandas dependency for DataFrame workflows.
