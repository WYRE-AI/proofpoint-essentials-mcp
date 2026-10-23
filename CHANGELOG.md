# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Share email redaction and Unicode-safe error limits across error boundaries; redact
  domain-tool hostnames and reduce vendor errors to status/code metadata.
- Clean failed and unconfirmed create results, including error-bearing 201 objects
  and non-JSON response text, instead of returning them raw.

### Added
- Initial release: MCP server for the Proofpoint Essentials API — organizations,
  domains, users, endpoint discovery, features, licensing, package, reporting, and
  token tools.
