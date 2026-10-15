import type { AppModules } from '@open-pencil/core/tools'

/**
 * The packages exported React code imports, which checking code against its design runs it
 * with; they load with the first check.
 */
export async function loadAppModules(): Promise<AppModules> {
  const [react, dom, client, server, radix, iconify, shaders] = await Promise.all([
    import('react'),
    import('react-dom'),
    import('react-dom/client'),
    import('react-dom/server'),
    import('radix-ui'),
    import('@iconify/react'),
    import('shaders/react')
  ])
  return {
    react,
    'react-dom': dom,
    'react-dom/client': client,
    'react-dom/server': server,
    'radix-ui': radix,
    '@iconify/react': iconify,
    'shaders/react': shaders
  }
}
