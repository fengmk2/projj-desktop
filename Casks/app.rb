cask "app" do
  arch arm: "arm64", intel: "x86_64"

  version "1.0.3"
  sha256 arm:   "2a1357d6267fda5d2b6a1bb5eca002085502e25074da3560eb5fa14b3ed729f9",
         intel: "4c182628f5ecaf55552a60582d7cd8d1ea265dc034dc3c70d7f846a4322faf5e"

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
