cask "projj-desktop" do
  arch arm: "arm64", intel: "x86_64"

  version "0.0.0"
  sha256 arm:   "6744c70011412f34338b3339491886a48afd3f317c86f701d26d97b7b1d03ad0",
         intel: "0401fcbc0b6fad860aa3b4a8aaf90d7f745743271aa1192ba71a3f53744700f2"

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
