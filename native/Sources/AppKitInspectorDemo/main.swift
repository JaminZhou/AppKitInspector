import AppKit
import AppKitInspectorProbe

@MainActor
final class DemoDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 600),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "AppKit Inspector Demo"
        window.titlebarAppearsTransparent = true
        window.center()
        window.contentViewController = makeContentController()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        _ = try? AppKitInspectorProbe.start()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func makeContentController() -> NSViewController {
        let split = NSSplitViewController()
        let sidebar = NSViewController()
        sidebar.view = NSVisualEffectView()
        (sidebar.view as? NSVisualEffectView)?.material = .sidebar
        split.addSplitViewItem(NSSplitViewItem(sidebarWithViewController: sidebar))

        let content = NSViewController()
        content.view = NSView()
        split.addSplitViewItem(NSSplitViewItem(viewController: content))

        let sessions = NSTextField(labelWithString: "SESSIONS")
        sessions.font = .systemFont(ofSize: 11, weight: .semibold)
        sessions.textColor = .secondaryLabelColor
        let current = NSButton(title: "Current Session", target: nil, action: nil)
        current.bezelStyle = .recessed
        current.contentTintColor = .controlAccentColor
        let add = NSButton(image: NSImage(systemSymbolName: "folder.badge.plus", accessibilityDescription: "Add Folder")!, target: nil, action: nil)
        add.bezelStyle = .accessoryBarAction
        [sessions, current, add].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            sidebar.view.addSubview($0)
        }

        let title = NSTextField(labelWithString: "Agent Session")
        title.font = .systemFont(ofSize: 24, weight: .bold)
        let search = NSSearchField()
        search.placeholderString = "Search events"
        let userCard = card(title: "USER", body: "Inspect this AppKit interface.")
        let assistantCard = card(title: "ASSISTANT", body: "Click any element to inspect its native view.")
        [title, search, userCard, assistantCard].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            content.view.addSubview($0)
        }

        NSLayoutConstraint.activate([
            sessions.topAnchor.constraint(equalTo: sidebar.view.topAnchor, constant: 28),
            sessions.leadingAnchor.constraint(equalTo: sidebar.view.leadingAnchor, constant: 18),
            current.topAnchor.constraint(equalTo: sessions.bottomAnchor, constant: 10),
            current.leadingAnchor.constraint(equalTo: sidebar.view.leadingAnchor, constant: 12),
            current.trailingAnchor.constraint(equalTo: sidebar.view.trailingAnchor, constant: -12),
            add.leadingAnchor.constraint(equalTo: sidebar.view.leadingAnchor, constant: 12),
            add.bottomAnchor.constraint(equalTo: sidebar.view.bottomAnchor, constant: -12),

            title.topAnchor.constraint(equalTo: content.view.topAnchor, constant: 54),
            title.leadingAnchor.constraint(equalTo: content.view.leadingAnchor, constant: 36),
            search.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 18),
            search.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            search.widthAnchor.constraint(equalToConstant: 320),
            userCard.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 24),
            userCard.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            userCard.trailingAnchor.constraint(equalTo: content.view.trailingAnchor, constant: -40),
            userCard.heightAnchor.constraint(equalToConstant: 88),
            assistantCard.topAnchor.constraint(equalTo: userCard.bottomAnchor, constant: 14),
            assistantCard.leadingAnchor.constraint(equalTo: userCard.leadingAnchor),
            assistantCard.trailingAnchor.constraint(equalTo: userCard.trailingAnchor),
            assistantCard.heightAnchor.constraint(equalToConstant: 148),
        ])
        sidebar.preferredContentSize = NSSize(width: 224, height: 600)
        return split
    }

    private func card(title: String, body: String) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        card.layer?.cornerRadius = 10
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 11, weight: .semibold)
        heading.textColor = .secondaryLabelColor
        let text = NSTextField(labelWithString: body)
        text.font = .systemFont(ofSize: 14)
        [heading, text].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            card.addSubview($0)
        }
        NSLayoutConstraint.activate([
            heading.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            heading.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            text.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 12),
            text.leadingAnchor.constraint(equalTo: heading.leadingAnchor),
        ])
        return card
    }
}

let application = NSApplication.shared
let delegate = DemoDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
