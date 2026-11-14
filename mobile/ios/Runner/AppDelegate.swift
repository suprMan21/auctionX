import CoreNFC
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SealReaderPlugin") {
      SealReaderPlugin.register(with: registrar)
    }
  }
}

/// Reads one seal with exactly one ISO ReadBinary of the NDEF file (S-MOB2).
///
/// Every read of that file raises the chip's SDM counter by one, and the server voids a take
/// unless tap 2 = tap 1 + 1. nfc_manager reads the NDEF file twice on its own when it finds a tag
/// (queryNDEFStatus + readNDEF) before Dart sees it, so a tap through the plugin is +3
/// (measured 2026-11-14). Here: select the NDEF app, select E104, one ReadBinary, stop.
/// Returns the raw file image; Dart parses the URL. Holds no keys and checks nothing.
final class SealReaderPlugin: NSObject, FlutterPlugin, NFCTagReaderSessionDelegate {
  private var session: NFCTagReaderSession?
  private var pending: FlutterResult?
  /// True once the ReadBinary was sent: from then on the counter has moved.
  private var chipRead = false

  private static let ndefAid = Data([0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01])
  private static let ndefFile = Data([0xE1, 0x04])

  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "am/seal_reader", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(SealReaderPlugin(), channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isAvailable":
      result(NFCTagReaderSession.readingAvailable)
    case "read":
      guard NFCTagReaderSession.readingAvailable else {
        result(FlutterError(code: "unavailable", message: nil, details: ["chipRead": false]))
        return
      }
      guard session == nil, pending == nil else {
        result(FlutterError(code: "busy", message: nil, details: ["chipRead": false]))
        return
      }
      let prompt = (call.arguments as? [String: Any])?["prompt"] as? String
      pending = result
      chipRead = false
      session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: nil)
      session?.alertMessage = prompt ?? ""
      session?.begin()
    case "cancel":
      session?.invalidate(errorMessage: "Cancelled")
      complete(error: "cancelled")
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func complete(data: Data? = nil, error code: String? = nil) {
    let read = chipRead
    DispatchQueue.main.async {
      guard let pending = self.pending else { return }
      self.pending = nil
      if let code = code {
        pending(FlutterError(code: code, message: nil, details: ["chipRead": read]))
      } else {
        pending(FlutterStandardTypedData(bytes: data ?? Data()))
      }
    }
  }

  private func fail(_ session: NFCTagReaderSession, _ code: String) {
    complete(error: code)
    session.invalidate(errorMessage: "That didn’t read as a seal")
  }

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    complete(error: "cancelled")
    DispatchQueue.main.async { if self.session === session { self.session = nil } }
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    if tags.count > 1 {
      session.alertMessage = "Hold the phone on one seal only"
      session.restartPolling()
      return
    }
    guard let first = tags.first, case let .iso7816(tag) = first else {
      fail(session, "not_a_seal")
      return
    }
    session.connect(to: first) { error in
      if error != nil { return self.fail(session, "read_failed") }
      let selectApp = NFCISO7816APDU(
        instructionClass: 0x00, instructionCode: 0xA4, p1Parameter: 0x04, p2Parameter: 0x0C,
        data: Self.ndefAid, expectedResponseLength: -1)
      tag.sendCommand(apdu: selectApp) { _, sw1, sw2, error in
        guard error == nil, sw1 == 0x90, sw2 == 0x00 else { return self.fail(session, "not_a_seal") }
        let selectFile = NFCISO7816APDU(
          instructionClass: 0x00, instructionCode: 0xA4, p1Parameter: 0x00, p2Parameter: 0x0C,
          data: Self.ndefFile, expectedResponseLength: -1)
        tag.sendCommand(apdu: selectFile) { _, sw1, sw2, error in
          guard error == nil, sw1 == 0x90, sw2 == 0x00 else { return self.fail(session, "not_a_seal") }
          let readBinary = NFCISO7816APDU(
            instructionClass: 0x00, instructionCode: 0xB0, p1Parameter: 0x00, p2Parameter: 0x00,
            data: Data(), expectedResponseLength: 256)
          self.chipRead = true
          tag.sendCommand(apdu: readBinary) { data, sw1, sw2, error in
            guard error == nil, sw1 == 0x90, sw2 == 0x00 else { return self.fail(session, "read_failed") }
            // Answer first so the invalidation callback finds nothing pending.
            self.complete(data: data)
            session.alertMessage = "Got it"
            session.invalidate()
          }
        }
      }
    }
  }
}
