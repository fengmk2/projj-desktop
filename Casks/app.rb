cask "app" do
  arch arm: "arm64", intel: "x86_64"

  version "1.0.2"
  sha256 arm:   "438321579939dff93e39369c7a60984e416aa3f6d6f7930da35ff01c2478d549",
         intel: "1ed2e67bddd944d0e49ef8bd1c953ea2c5adc889a9c4c361c990c2b8eaa52da0"

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
