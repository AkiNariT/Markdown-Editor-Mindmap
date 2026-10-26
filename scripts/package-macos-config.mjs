import path from 'node:path';

const architectures = new Set(['arm64', 'x64']);
export const macBundleId = 'io.github.akinarit.md';
export const macMinimumVersion = '13.0';

function requireArchitecture(arch) {
  if (!architectures.has(arch)) throw new Error('macOS architecture must be arm64 or x64.');
  return arch;
}

export function parseMacPackagingArgs(args, host = process) {
  let arch, unsignedDir = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--unsigned-dir' && !unsignedDir) unsignedDir = true;
    else if ((arg === '--arch' || arg.startsWith('--arch=')) && arch === undefined) {
      arch = requireArchitecture(arg === '--arch' ? args[++index] : arg.slice('--arch='.length));
    } else throw new Error(`Unsupported or duplicate macOS packaging argument: ${arg}`);
  }
  arch = requireArchitecture(arch ?? host.arch);
  if (host.platform !== 'darwin' && !unsignedDir) {
    throw new Error('Runnable macOS packages must be built on macOS. Use --unsigned-dir only for an incomplete structure inspection.');
  }
  return { arch, unsignedDir };
}

export function packageStagePath(project, platform, arch) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Unsupported packaging platform.');
  requireArchitecture(arch);
  const root = path.resolve(project);
  const parent = path.join(root, '.package-stage');
  const stage = path.join(parent, `${platform}-${arch}`);
  if (path.dirname(parent) !== root || path.dirname(stage) !== parent) throw new Error('Unexpected packaging stage path.');
  return stage;
}

export function macArtifactName(arch, version, extension) {
  requireArchitecture(arch);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) throw new Error('Invalid release version.');
  if (!['zip', 'dmg'].includes(extension)) throw new Error('Unsupported macOS artifact format.');
  return `MD-macOS-${arch}-${version}.${extension}`;
}

export function macPackagerOptions({ project, arch, electronVersion }) {
  requireArchitecture(arch);
  return {
    dir: packageStagePath(project, 'darwin', arch), out: path.resolve(project, '.packaged'),
    name: 'MD', platform: 'darwin', arch, electronVersion,
    icon: path.resolve(project, 'assets/icon.icns'), appBundleId: macBundleId,
    appCategoryType: 'public.app-category.productivity', darwinDarkModeSupport: true,
    overwrite: true, asar: false, prune: false,
    extendInfo: {
      LSMinimumSystemVersion: macMinimumVersion, NSHighResolutionCapable: true, CFBundleIconFile: 'MD.icns',
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Markdown document', CFBundleTypeExtensions: ['md', 'markdown'],
          CFBundleTypeRole: 'Editor', LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['net.daringfireball.markdown'], CFBundleTypeIconFile: 'MD.icns',
        },
        {
          CFBundleTypeName: 'MD mind map', CFBundleTypeExtensions: ['mdmap'],
          CFBundleTypeRole: 'Editor', LSHandlerRank: 'Alternate',
          LSItemContentTypes: [`${macBundleId}.mindmap`], CFBundleTypeIconFile: 'MD.icns',
        },
      ],
      UTImportedTypeDeclarations: [{
        UTTypeIdentifier: 'net.daringfireball.markdown', UTTypeDescription: 'Markdown document',
        UTTypeConformsTo: ['public.plain-text'],
        UTTypeTagSpecification: { 'public.filename-extension': ['md', 'markdown'], 'public.mime-type': 'text/markdown' },
      }],
      UTExportedTypeDeclarations: [{
        UTTypeIdentifier: `${macBundleId}.mindmap`, UTTypeDescription: 'MD mind map',
        UTTypeConformsTo: ['public.json'], UTTypeIconFile: 'MD.icns',
        UTTypeTagSpecification: { 'public.filename-extension': ['mdmap'] },
      }],
    },
  };
}
