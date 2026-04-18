# AOK System Rules

This directory contains deterministic context boundaries for AOK's evaluation engine.
Currently, AOK operates primarily on TS AST pattern matching, but future versions will parse these architectural bounds.

## Current constraints

1. Only modify UI selectors if tests flag a `strict mode violation`.
2. Do not delete files; rely on safe patch backups inside `.aok/backups`.
