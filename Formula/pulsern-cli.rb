class PulsernCli < Formula
  desc "Run the PulseRN React Native debugger in a local web browser"
  homepage "https://github.com/maahibhama/PulseRN"
  url "https://github.com/maahibhama/PulseRN/releases/download/cli-v1.0.4/pulsern-1.0.4.tgz"
  sha256 "8ef0ae6f5974332a0ee0cfd284f38240aae42feeadb6f7c35d8ed9972ca19fbb"
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
