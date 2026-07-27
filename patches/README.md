# Dependency patches

## `l2d@2.1.1.patch`

This patch is rebuilt from upstream tag `v2.1.1` (`515a6ed1b077ffa14e79156f10298c3e7ca49053`) and changes only the published browser bundle and declarations.

The blog needs a host-controlled request hook for every Cubism 2 dependency, abort propagation, recoverable serialized loading, scoped input ownership, deterministic listener cleanup, and a permanently muted renderer core. Upstream 2.1.1 otherwise swallows some failures, leaves its global queue rejected after one failure, and creates model-owned audio elements.

Remove the patch only after a pinned upstream release exposes equivalent request, cancellation, input, audio, error, and teardown contracts and the Live2D lifecycle/browser suites pass without it.
