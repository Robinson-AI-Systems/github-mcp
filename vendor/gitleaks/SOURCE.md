# Reviewed Gitleaks rule subset

Source: https://github.com/gitleaks/gitleaks/blob/5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c/config/gitleaks.toml
Revision: 5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c. MIT license retained in LICENSE and copied into the native worker image.

reviewed-rules.json contains 26 high-confidence provider rules with the original expression, adapted expression, flags and prefilter keywords. Go inline case modifiers are translated to JavaScript flags; atlasv1 case sensitivity is retained. Capturing indices identify the credential itself, excluding surrounding context. A recognized token's trailing token characters are conservatively hidden rather than revealing a partial suffix. These bounded reviewed expressions are code, not agent-supplied arbitrary regex.

Existing GitHub/RTC/private-key signatures, database URI/connection-string/password assignments, cloud-key assignments and a deliberately narrower generic credential-key heuristic supplement this subset. The generic heuristic uses exact key names, quoted literals, minimum length and entropy; it does not copy the corpus's broad keyword expression verbatim. This is neither the complete Gitleaks corpus nor its entropy/allowlist/history engine, nor GitHub Secret Protection. Synthetic positive fixtures cover every imported rule. No real credential is included.
