cask "app" do
  arch arm: "arm64", intel: "x86_64"

  version "1.0.1"
  sha256 arm:   "58e6e1c4e5c92c3db487cec32092b906e6ab6cdf5bce23ab65ab514ba0a67fc2",
         intel: "8b41ee3aee070f86cc71d00674c6262e27f6d025a62b357d2f8572b1219ad202"

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
