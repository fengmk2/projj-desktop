import AppKit

let output = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedRed: 0.68, green: 0.33, blue: 0.17, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 198, yRadius: 198).fill()
NSColor.white.setStroke()
let branch = NSBezierPath()
branch.lineWidth = 58
branch.lineCapStyle = .round
branch.move(to: NSPoint(x: 376, y: 300))
branch.line(to: NSPoint(x: 376, y: 720))
branch.move(to: NSPoint(x: 376, y: 450))
branch.curve(to: NSPoint(x: 670, y: 676), controlPoint1: NSPoint(x: 630, y: 450), controlPoint2: NSPoint(x: 670, y: 490))
branch.stroke()
NSColor.white.setFill()
for point in [NSPoint(x: 376, y: 292), NSPoint(x: 376, y: 732), NSPoint(x: 670, y: 698)] {
    NSBezierPath(ovalIn: NSRect(x: point.x - 72, y: point.y - 72, width: 144, height: 144)).fill()
    NSColor(calibratedRed: 0.68, green: 0.33, blue: 0.17, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: point.x - 30, y: point.y - 30, width: 60, height: 60)).fill()
    NSColor.white.setFill()
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
