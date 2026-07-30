cask "pulsern" do
  version "0.1.1"
  sha256 :no_check

  url "https://github.com/maahibhama/PulseRN/releases/download/v#{version}/PulseRN-#{version}-mac-universal.dmg"
  name "PulseRN"
  desc "Open-source React Native desktop debugger"
  homepage "https://github.com/maahibhama/PulseRN"

  depends_on macos: :catalina

  app "PulseRN.app"

  zap trash: [
    "~/Library/Application Support/PulseRN",
    "~/Library/Caches/dev.pulsern.desktop",
    "~/Library/Logs/PulseRN",
    "~/Library/Preferences/dev.pulsern.desktop.plist",
    "~/Library/Saved Application State/dev.pulsern.desktop.savedState",
  ]

  caveats <<~EOS
    PulseRN preview releases are currently unsigned. Install with:

      brew install --cask --no-quarantine pulsern

    Signed and notarized releases are planned before the stable release.
  EOS
end
