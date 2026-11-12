# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release: MCP server for the Proofpoint Essentials API — organizations,
  domains, users, endpoint discovery, features, licensing, package, reporting, and
  token tools.
- Eight sender-list tools with no `list` argument, so a gateway that grants access per
  tool name can grant block and allow separately: `proofpoint_essentials_org_block_list_add`,
  `_org_block_list_remove`, `_org_allow_list_add`, `_org_allow_list_remove`, and the
  `users_` equivalents (`proofpoint_essentials_users_block_list_add`, and so on).
  `block_list_add` is a routine idempotent write for unattended automation; the other six
  are high-impact. Each reads the current lists, changes one list only, writes both lists,
  re-reads to verify, and fails closed when the lists cannot be read or the write cannot be
  confirmed. Entries are validated (no host wildcards, no IPv6, CIDR /24 to /32, at most 100,
  no leading zeros in wildcard octets or CIDR prefixes). Invalid entries are named by their
  position in `entries`. Verification compares both lists as sets, and its error reports
  counts so it fits the 300-character error limit.

### Changed
- Requires `@wyre-ai/node-proofpoint-essentials` >= 1.1.0 for `client.senderLists`.
- `proofpoint_essentials_users_update` always reads the existing user and merges on every
  update, also when `type` is supplied, and sends the merged record back in full. It refuses
  to update when the record cannot be read, matched by `primary_email`, or has no account
  type to keep. Empty `data` (also when only blank `type` or `role` remain) and non-string
  `type` or `role` are rejected.
- Every handler argument that ends up in an upstream URL path (`orgDomain`, `domain`, user
  `email`) is validated: no whitespace, control characters, `/`, `\`, `?`, `#`, and not `.`
  or `..`, which URL resolution would collapse onto a parent resource. A user `email` used
  as a path segment must also be shaped like an email address.

### Fixed
- Tool names are resolved on the handler table's own keys only; before, `constructor`
  returned the SDK client, including the upstream credentials, as the tool result.
- Share email redaction and Unicode-aware error limits across error boundaries; redact
  domain-tool hostnames and reduce vendor errors to status/code metadata.
- Clean failed and unconfirmed create results, including error-bearing 201 objects
  and non-JSON response text, instead of returning them raw.
