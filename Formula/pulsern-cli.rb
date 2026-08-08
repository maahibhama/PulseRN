class PulsernCli < Formula
  desc "Run the PulseRN React Native debugger in a local web browser"
  homepage "https://github.com/maahibhama/PulseRN"
  url "https://github.com/maahibhama/PulseRN/releases/download/cli-v1.0.6/pulsern-1.0.6.tgz"
  sha256 "d3f7b7287a4350c85bb3b410ad585bbdccf1e13be7b221fe5669ea49167b802a"
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
