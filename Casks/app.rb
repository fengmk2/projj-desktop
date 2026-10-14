cask "app" do
  arch arm: "arm64", intel: "x86_64"

  version "1.0.0"
  sha256 arm:   "a253e1678a0bcf78f55be9dbc3963d1bc1ce5d3a03e6aeaa251c6d3a4d9779d5",
         intel: "bd674e6ecd4538e2f912bc6ab5da68000e75b3f4d6ffc2f6dd2539711d2a586b"

  url "https://github.com/fengmk2/projj-desktop/releases/download/v#{version}/Projj-v#{version}-macOS-#{arch}.zip"
  name "Projj Desktop"
  desc "Native desktop home for Git repositories"
  homepage "https://github.com/fengmk2/projj-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Projj.app"
  binary "#{appdir}/Projj.app/Contents/Resources/app/bin/projj"
end
