class PulsernCli < Formula
  desc "Run the PulseRN React Native debugger in a local web browser"
  homepage "https://github.com/maahibhama/PulseRN"
  url "https://github.com/maahibhama/PulseRN/releases/download/cli-v1.0.6/pulsern-1.0.6.tgz"
  sha256 "d40af1bc262a0b1fe7bd4e975b997f74acd149533012a0419161e93db854d6bd"
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
