class PulsernCli < Formula
  desc "Run the PulseRN React Native debugger in a local web browser"
  homepage "https://github.com/maahibhama/PulseRN"
  url "https://github.com/maahibhama/PulseRN/releases/download/cli-v1.0.4/pulsern-1.0.4.tgz"
  sha256 "d3d5fac7eb105553a09066cb3eda409d44d62e3dfeb19b77c959ba68fbbc09ac"
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
