# Private package access

The package is hosted on GitHub Packages under `software-factory-workshop`. Access to this skills repository does not itself grant access to the design-system package.

## Developer machine

Add the scoped registry to the app's `.npmrc`, preserving existing settings:

```ini
@software-factory-workshop:registry=https://npm.pkg.github.com
```

A GitHub account with package access and a personal access token (classic) with `read:packages` is required. Authorize organizational SSO if applicable. Authenticate interactively with the GitHub username and the token as the password:

```sh
npm login --scope=@software-factory-workshop --auth-type=legacy --registry=https://npm.pkg.github.com
npm install @software-factory-workshop/nuxt-adeo-ds@0.1.1
```

Use existing configured credentials when available. Do not ask the user to paste a token into chat or commit a token. Git/SSH access to the repository and npm package authentication are separate.

## GitHub Actions consumer

An administrator must grant the consuming repository read access under the design-system package's **Manage Actions access** settings. Then adapt the app's existing workflow:

```yaml
permissions:
  contents: read
  packages: read
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
      cache: npm
      registry-url: https://npm.pkg.github.com
      scope: '@software-factory-workshop'
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Merge required permissions from the existing workflow. `packages: read` alone does not grant another repository access to this private package.

## Other CI providers

Store a classic token with `read:packages` in the provider's secret store as `NODE_AUTH_TOKEN`. Add this literal placeholder to npm configuration:

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Keep the scoped registry line too. The actual token stays in the secret store. Install with the committed lockfile.

## Diagnose access failures

- Requests to `registry.npmjs.org`: the scoped registry setting is missing or overridden.
- HTTP 401: authentication is missing or invalid.
- HTTP 403: check token scope, SSO and package permissions.
- HTTP 404 for a known private package: verify authenticated access and the requested version; GitHub can hide inaccessible packages.
- GitHub Actions failure despite `packages: read`: check **Manage Actions access** for that specific repository.
- An already-installed `UApp` or duplicated module is not an authentication issue; inspect Nuxt configuration separately.

Report the concrete missing access if it requires an administrator. Continue work that does not depend on that access, but do not claim a successful installation until it has been tested.

Reference: [GitHub npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).
