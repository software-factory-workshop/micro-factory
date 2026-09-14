---
name: adeo-nuxt-ui
description: Install and use the ADEO Nuxt UI design system in Nuxt 4 applications, including its private package, ADEO components, theme overrides, and CI setup. Use for ADEO application work; this is not a Leroy Merlin or other Mozaic brand preset.
---

# ADEO Nuxt UI

Build with `@software-factory-workshop/nuxt-adeo-ds`, a Nuxt layer built on Nuxt UI 4 and Mozaic's ADEO preset. It supplies 22 composed ADEO components, Nuxt UI components, ADEO tokens and locally served Roboto fonts. The catalogue is a separate application.

## Integrate into the application

Inspect the app's package manager, Nuxt version, existing modules, CSS entrypoint and root component first. Preserve its routes and app-specific configuration. This package targets Nuxt 4.5.2+ within Nuxt 4, Vue 3.5+, and Node 22.19+ or 24.11+. Nuxt UI is pinned to 4.11.1 in the initial release. Do not migrate a non-Nuxt application implicitly.

The initial published version is `0.1.1`. Keep an existing consumer's version unless an upgrade is part of the task; check the package metadata and changelog before upgrading.

1. Follow [private package access](references/private-package.md) when registry authentication or CI access is not already configured.
2. Install using the app's package manager. For a new npm consumer:

   ```sh
   npm install @software-factory-workshop/nuxt-adeo-ds@0.1.1
   ```

3. Add the package to the existing layer list:

   ```ts
   // nuxt.config.ts
   export default defineNuxtConfig({
     extends: ['@software-factory-workshop/nuxt-adeo-ds']
   })
   ```

4. Wrap the existing root content in `UApp`, or retain the existing `UApp`:

   ```vue
   <!-- app/app.vue -->
   <template>
     <UApp>
       <NuxtLayout>
         <NuxtPage />
       </NuxtLayout>
     </UApp>
   </template>
   ```

The layer registers `@nuxt/ui`, imports CSS and fonts, and auto-imports components. Consolidate duplicate Nuxt UI registration and duplicate Tailwind/Nuxt UI CSS imports when integrating into an already themed app. Keep unrelated application CSS. No sibling Mozaic or design-system checkout is required.

## Build with the components

Use Nuxt UI's `UButton`, `UInput`, `UForm`, `UFormField`, `USelect`, `UTable`, `UModal`, `UTabs` and other `U*` components directly. They receive the ADEO theme and retain Nuxt UI 4 APIs. Do not invent parallel `AdeoButton` or `AdeoTable` components.

```vue
<template>
  <section class="space-y-6">
    <AdeoPageHeader title="Projects" description="Manage your team's projects.">
      <template #actions>
        <UButton icon="i-lucide-plus" to="/projects/new">New project</UButton>
      </template>
    </AdeoPageHeader>
    <AdeoEmptyState title="No projects yet" description="Create your first project.">
      <UButton to="/projects/new">Create project</UButton>
    </AdeoEmptyState>
  </section>
</template>
```

Before using a composed component, read [component choices and constraints](references/components.md). The installed package's `COMPONENTS.md` is the full API reference. Verify unfamiliar Nuxt UI APIs against the installed version or its official documentation.

## Preserve the ADEO theme

Use semantic colors (`primary`, `secondary`, `neutral`, `success`, `info`, `warning`, `error`) and utilities such as `text-highlighted`, `text-muted`, `bg-default`, `bg-elevated`, and `border-default`. Primary is ADEO teal `#007f8c`; secondary is ADEO purple. Green represents success. Do not substitute Leroy Merlin green or import another Mozaic brand preset.

Roboto, the token palettes, spacing basis and 2/4/6px radii are supplied by the layer. Use Lucide icons with `i-lucide-*` names. Change component defaults in the consumer's `app/app.config.ts`, preserving inherited ADEO colors unless the user explicitly requests a brand change:

```ts
export default defineAppConfig({
  ui: { button: { defaultVariants: { size: 'lg' } } }
})
```

Light mode is the reference. The optional dark mapping is a local adaptation, not an official Mozaic dark preset. This package adapts Mozaic to Nuxt UI; do not promise pixel-for-pixel parity with Mozaic SCSS.

## Verify the consumer

Run the application's existing typecheck and production build, or `npx nuxt typecheck` and `npx nuxt build` where appropriate. Check a rendered route for ADEO styling, working controls, and hydration or unresolved-component errors. Confirm that app actions navigate or update real state. Labels, validation and backend operations remain the application's responsibility.

For registry failures, use the targeted diagnosis in [private package access](references/private-package.md); do not remove authentication or switch the private package to public npm.

Sources: [package and installation guide](https://github.com/software-factory-workshop/nuxt-adeo-ds/tree/main/layer), [full component APIs](https://github.com/software-factory-workshop/nuxt-adeo-ds/blob/main/COMPONENTS.md), [Nuxt UI documentation](https://ui.nuxt.com/docs/getting-started), [Mozaic ADEO colors](https://mozaic.adeo.cloud/foundations/colours/adeo/).
