# Offline contract workbench

This directory pins small, credential-free request and response examples for the
four local adapter boundaries. It is deliberately offline: verification must
never call a paid API, start a service, or read a `.env` file.

Run:

```powershell
node contracts/verify.mjs
```

The verifier checks that:

- every contract points to an existing implementation source;
- the declared HTTP method and route still appear in that source;
- required request and response fields exist in the fixtures;
- no fixture contains credential-shaped keys or values;
- each boundary includes a safe 4xx failure example.

When an adapter changes, update its fixture and contract entry in the same
change. Fixtures are examples of the local boundary, not proof that an upstream
provider is available.
