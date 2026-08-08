class PulsernCli < Formula
  desc "Run the PulseRN React Native debugger in a local web browser"
  homepage "https://github.com/maahibhama/PulseRN"
  url "https://github.com/maahibhama/PulseRN/releases/download/cli-v1.0.7/pulsern-1.0.7.tgz"
  sha256 "8407f717ef9d5f6ea34901f90e115edfc727b21f0c085ef03f7d89105a99c7fc"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pulsern --version")
    assert_match "PulseRN local web debugger", shell_output("#{bin}/pulsern --help")
  end
end
