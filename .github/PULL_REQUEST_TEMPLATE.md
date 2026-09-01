## What changed

Name the component, operator problem, and smallest complete solution.

## Verification

- [ ] Every commit includes a matching `Signed-off-by` trailer (`git commit -s`).
- [ ] Core change: `cargo fmt --check`, strict Clippy, tests, and release build passed or are not applicable.
- [ ] App change: `npm run lint`, tests, build, and relevant package smoke checks passed or are not applicable.
- [ ] Hardware/provider behavior was tested, or the exact unverified boundary is stated.
- [ ] Documentation and changelog match current behavior.

## Safety and privacy

- [ ] No prompt, transcript, credential, token, serial number, private path, or raw provider payload is exposed.
- [ ] Consequential actions retain confirmation or continuous-hold authorization.
- [ ] The change does not create one-press push, merge, deploy, delete, spend, credential, or permission approval.
- [ ] Screen state remains understandable without color alone.

## Evidence boundary

State separately what is implemented, automatically tested, packaged, installed, provider-accepted, physically tested, and still unverified.
