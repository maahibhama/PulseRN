const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const MARKER = '# PulseRN: Xcode 26.4 fmt consteval compatibility';
const PATCH = `    ${MARKER}
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      content = File.read(fmt_base)
      patched = content.gsub(/^#  define FMT_USE_CONSTEVAL 1$/, '#  define FMT_USE_CONSTEVAL 0')
      if patched != content
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
      end
    end

`;

module.exports = function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    async (nextConfig) => {
      const podfilePath = path.join(nextConfig.modRequest.platformProjectRoot, 'Podfile');
      const podfile = fs.readFileSync(podfilePath, 'utf8');
      if (podfile.includes(MARKER)) return nextConfig;
      const anchor = '    react_native_post_install(';
      if (!podfile.includes(anchor)) {
        throw new Error('PulseRN could not find the Expo React Native post-install hook.');
      }
      fs.writeFileSync(podfilePath, podfile.replace(anchor, `${PATCH}${anchor}`));
      return nextConfig;
    },
  ]);
};
