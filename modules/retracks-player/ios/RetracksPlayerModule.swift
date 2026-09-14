import AVFoundation
import ExpoModulesCore
import MediaPlayer
import UIKit

struct RetracksTrack: Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String? = nil
  @Field var durationMs: Double = 0
  @Field var artworkUri: String? = nil
}

struct RetracksSegment: Record {
  @Field var startMs: Double = 0
  @Field var lengthMs: Double = 0
  @Field var fadeMs: Double = 0
  @Field var fadeInMs: Double = 0
}

private struct SavedTrack: Codable {
  let id: String
  let uri: String
  let title: String
  let artist: String
  let album: String?
  let durationMs: Double
  let artworkUri: String?
}

private struct SavedQueue: Codable {
  let key: String
  let tracks: [SavedTrack]
}

public final class RetracksPlayerModule: Module {
  private let player = AVPlayer()
  private var tracks: [RetracksTrack] = []
  private var index = -1
  private var repeatMode = 2
  private var segment: RetracksSegment?
  /** 再生中の曲に焼き込んだ区間。設定変更は次の曲から反映する。 */
  private var activeSegment: RetracksSegment?
  private var fullPlayback = false
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var failureObserver: NSObjectProtocol?
  private var interruptionObserver: NSObjectProtocol?
  private var routeChangeObserver: NSObjectProtocol?
  private var remoteTargets: [(MPRemoteCommand, Any)] = []
  private var snapshot: [String: Any] = RetracksPlayerModule.emptySnapshot
  private let snapshotLock = NSLock()
  private var wasPlayingBeforeInterruption = false
  private var tickCount = 0
  private let defaultsKey = "retracks.ios.savedQueue"

  private static let emptySnapshot: [String: Any] = [
    "connected": false,
    "isPlaying": false,
    "index": -1,
    "positionMs": 0.0,
    "durationMs": 0.0,
    "queueSize": 0,
    "repeatMode": 2,
    "fullPlayback": false
  ]

  public func definition() -> ModuleDefinition {
    Name("RetracksPlayer")
    Events("onTrackChange", "onPlaybackStateChange", "onSegmentCut")

    AsyncFunction("requestNotificationPermissionAsync") { () -> [String: Any] in
      // iOSのロック画面メディア操作に通知権限は不要。
      ["status": "granted", "granted": true]
    }

    AsyncFunction("prepareAsync") { (promise: Promise) in
      DispatchQueue.main.async {
        do {
          let session = AVAudioSession.sharedInstance()
          try session.setCategory(.playback, mode: .default)
          try session.setActive(true)
          UIApplication.shared.beginReceivingRemoteControlEvents()
          self.installObservers()
          self.installRemoteCommands()
          self.refreshSnapshot()
          promise.resolve(true)
        } catch {
          promise.reject(
            "E_AUDIO_SESSION",
            "Failed to prepare the iOS audio session: \(error.localizedDescription)"
          )
        }
      }
    }

    AsyncFunction("setQueue") {
      (tracks: [RetracksTrack], startIndex: Int, queueKey: String, promise: Promise) in
      DispatchQueue.main.async {
        self.tracks = tracks
        self.index = tracks.isEmpty ? -1 : min(max(0, startIndex), tracks.count - 1)
        self.fullPlayback = false
        self.saveQueue(key: queueKey)
        self.loadCurrent(autoplay: false)
        promise.resolve(tracks.count)
      }
    }

    AsyncFunction("getSavedQueue") { () -> [String: Any] in
      guard let data = UserDefaults.standard.data(forKey: self.defaultsKey),
            let saved = try? JSONDecoder().decode(SavedQueue.self, from: data) else {
        return ["key": "", "tracks": []]
      }
      return ["key": saved.key, "tracks": saved.tracks.map(self.savedTrackDictionary)]
    }

    Function("setSegment") { (segment: RetracksSegment?) in
      DispatchQueue.main.async { self.segment = segment }
    }

    Function("setRepeatMode") { (mode: Int) in
      DispatchQueue.main.async {
        self.repeatMode = min(max(mode, 0), 2)
        self.refreshSnapshot()
      }
    }

    AsyncFunction("getAlbumYears") { () -> [String: Int] in [:] }

    AsyncFunction("getArtworkDataUri") { (trackId: String, requestedSize: Double) -> String? in
      guard let persistentID = UInt64(trackId), persistentID > 0 else { return nil }

      let query = MPMediaQuery.songs()
      query.addFilterPredicate(
        MPMediaPropertyPredicate(
          value: NSNumber(value: persistentID),
          forProperty: MPMediaItemPropertyPersistentID
        )
      )
      guard let artwork = query.items?.first?.artwork else { return nil }

      // 一覧では小さい画像だけを生成し、巨大な原寸画像をJSへ渡さない。
      let side = min(max(requestedSize, 32), 600)
      guard let image = artwork.image(at: CGSize(width: side, height: side)),
            let data = image.jpegData(compressionQuality: 0.82) else { return nil }
      return "data:image/jpeg;base64,\(data.base64EncodedString())"
    }
    AsyncFunction("getTrackFolders") { () -> [String: Any] in
      ["nonMusicTrackIds": [], "folderIdByTrackId": [:], "folderNames": [:]]
    }
    AsyncFunction("getExitReasons") { () -> [[String: Any]] in [] }

    Function("playCurrentFromStart") {
      DispatchQueue.main.async {
        self.fullPlayback = true
        self.activeSegment = nil
        self.seek(milliseconds: 0)
        self.player.play()
        self.playbackChanged()
      }
    }
    Function("play") {
      DispatchQueue.main.async {
        if self.player.currentItem == nil { self.loadCurrent(autoplay: false) }
        self.player.play()
        self.playbackChanged()
      }
    }
    Function("pause") {
      DispatchQueue.main.async {
        self.player.pause()
        self.playbackChanged()
      }
    }
    Function("next") { DispatchQueue.main.async { self.advance(1) } }
    Function("previous") { DispatchQueue.main.async { self.advance(-1) } }
    Function("skipTo") { (nextIndex: Int) in
      DispatchQueue.main.async {
        guard self.tracks.indices.contains(nextIndex) else { return }
        self.index = nextIndex
        self.fullPlayback = false
        self.loadCurrent(autoplay: self.player.rate > 0)
      }
    }
    AsyncFunction("seekTo") { (positionMs: Double, promise: Promise) in
      DispatchQueue.main.async {
        self.seek(milliseconds: positionMs)
        promise.resolve(nil)
      }
    }
    Function("getStatus") { self.readSnapshot() }

    OnDestroy { self.tearDown() }
  }

  private func installObservers() {
    if endObserver == nil {
      endObserver = NotificationCenter.default.addObserver(
        forName: .AVPlayerItemDidPlayToEndTime,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let self, notification.object as? AVPlayerItem === self.player.currentItem else { return }
        self.finishedCurrent()
      }
    }
    if failureObserver == nil {
      failureObserver = NotificationCenter.default.addObserver(
        forName: .AVPlayerItemFailedToPlayToEndTime,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let self, notification.object as? AVPlayerItem === self.player.currentItem else { return }
        self.finishedCurrent()
      }
    }
    if interruptionObserver == nil {
      interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main
      ) { [weak self] notification in
        self?.handleInterruption(notification)
      }
    }
    if routeChangeObserver == nil {
      routeChangeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance(),
        queue: .main
      ) { [weak self] notification in
        self?.handleRouteChange(notification)
      }
    }
    if timeObserver == nil {
      timeObserver = player.addPeriodicTimeObserver(
        forInterval: CMTime(seconds: 0.05, preferredTimescale: 1000),
        queue: .main
      ) { [weak self] _ in
        self?.tick()
      }
    }
  }

  private func installRemoteCommands() {
    guard remoteTargets.isEmpty else { return }
    let center = MPRemoteCommandCenter.shared()
    addRemote(center.playCommand) { [weak self] _ in
      DispatchQueue.main.async { self?.player.play(); self?.playbackChanged() }
      return .success
    }
    addRemote(center.pauseCommand) { [weak self] _ in
      DispatchQueue.main.async { self?.player.pause(); self?.playbackChanged() }
      return .success
    }
    addRemote(center.nextTrackCommand) { [weak self] _ in
      DispatchQueue.main.async { self?.advance(1) }
      return .success
    }
    addRemote(center.previousTrackCommand) { [weak self] _ in
      DispatchQueue.main.async { self?.advance(-1) }
      return .success
    }
    addRemote(center.changePlaybackPositionCommand) { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      DispatchQueue.main.async { self?.seek(milliseconds: event.positionTime * 1000) }
      return .success
    }
  }

  private func addRemote(_ command: MPRemoteCommand, handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
    command.isEnabled = true
    let token = command.addTarget(handler: handler)
    remoteTargets.append((command, token))
  }

  private func loadCurrent(autoplay: Bool) {
    guard tracks.indices.contains(index), let url = URL(string: tracks[index].uri), !tracks[index].uri.isEmpty else {
      player.replaceCurrentItem(with: nil)
      refreshSnapshot()
      return
    }
    player.replaceCurrentItem(with: AVPlayerItem(url: url))
    player.volume = 1
    activeSegment = fullPlayback ? nil : segment
    let start = effectiveStartMs
    if start > 0 { seek(milliseconds: start) }
    if autoplay { player.play() }
    updateNowPlaying()
    refreshSnapshot()
    sendEvent("onTrackChange", ["index": index, "id": tracks[index].id])
  }

  private var effectiveStartMs: Double {
    guard let segment = activeSegment else { return 0 }
    let duration = tracks.indices.contains(index) ? tracks[index].durationMs : 0
    let start = max(0, segment.startMs)
    return start >= duration ? 0 : start
  }

  private var effectiveEndMs: Double? {
    guard let segment = activeSegment, tracks.indices.contains(index) else { return nil }
    let start = effectiveStartMs
    return min(tracks[index].durationMs, start + max(0, segment.lengthMs))
  }

  private var effectiveLengthMs: Double {
    guard let end = effectiveEndMs else { return 0 }
    return max(0, end - effectiveStartMs)
  }

  private func tick() {
    guard player.currentItem != nil else { refreshSnapshot(); return }
    let position = currentPositionMs
    if let end = effectiveEndMs {
      let half = effectiveLengthMs / 2
      let fadeOut = min(max(0, activeSegment?.fadeMs ?? 0), half)
      let fadeIn = min(max(0, activeSegment?.fadeInMs ?? 0), half)
      if fadeOut > 0, position >= end - fadeOut {
        player.volume = Float(max(0, min(1, (end - position) / fadeOut)))
      } else if fadeIn > 0, position < effectiveStartMs + fadeIn {
        player.volume = Float(max(0, min(1, (position - effectiveStartMs) / fadeIn)))
      } else {
        player.volume = 1
      }
      if position >= end, player.rate > 0 {
        let elapsed = max(0, position - effectiveStartMs)
        sendEvent("onSegmentCut", [
          "expectedMs": activeSegment?.lengthMs ?? 0,
          "elapsedMs": elapsed,
          "driftMs": elapsed - (activeSegment?.lengthMs ?? 0)
        ])
        finishedCurrent()
      }
    }
    tickCount = (tickCount + 1) % 4
    if tickCount == 0 {
      refreshSnapshot()
      updateElapsedNowPlaying()
    }
  }

  private func finishedCurrent() {
    if repeatMode == 1 {
      loadCurrent(autoplay: true)
    } else if index + 1 < tracks.count {
      index += 1
      fullPlayback = false
      loadCurrent(autoplay: true)
    } else if repeatMode == 2, !tracks.isEmpty {
      index = 0
      fullPlayback = false
      loadCurrent(autoplay: true)
    } else {
      player.pause()
      player.volume = 1
      playbackChanged()
    }
  }

  private func advance(_ offset: Int) {
    guard !tracks.isEmpty else { return }
    let wasPlaying = player.rate > 0
    var next = index + offset
    if repeatMode == 2 {
      next = (next % tracks.count + tracks.count) % tracks.count
    } else {
      next = min(max(0, next), tracks.count - 1)
    }
    index = next
    fullPlayback = false
    loadCurrent(autoplay: wasPlaying)
  }

  private func seek(milliseconds: Double) {
    let time = CMTime(seconds: max(0, milliseconds) / 1000, preferredTimescale: 1000)
    player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
    refreshSnapshot()
  }

  private var currentPositionMs: Double {
    let seconds = player.currentTime().seconds
    return seconds.isFinite ? max(0, seconds * 1000) : 0
  }

  private func playbackChanged() {
    refreshSnapshot()
    updateElapsedNowPlaying()
    sendEvent("onPlaybackStateChange", ["isPlaying": player.rate > 0])
  }

  private func handleInterruption(_ notification: Notification) {
    guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
    if type == .began {
      wasPlayingBeforeInterruption = player.rate > 0
      player.pause()
      playbackChanged()
      return
    }
    let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
    let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
    if wasPlayingBeforeInterruption, shouldResume {
      try? AVAudioSession.sharedInstance().setActive(true)
      player.play()
    }
    wasPlayingBeforeInterruption = false
    playbackChanged()
  }

  private func handleRouteChange(_ notification: Notification) {
    guard let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          AVAudioSession.RouteChangeReason(rawValue: rawReason) == .oldDeviceUnavailable else { return }
    player.pause()
    playbackChanged()
  }

  private func readSnapshot() -> [String: Any] {
    snapshotLock.lock()
    defer { snapshotLock.unlock() }
    return snapshot
  }

  private func refreshSnapshot() {
    let next: [String: Any] = [
      "connected": true,
      "isPlaying": player.rate > 0,
      "index": index,
      "positionMs": currentPositionMs,
      "durationMs": tracks.indices.contains(index) ? tracks[index].durationMs : 0,
      "queueSize": tracks.count,
      "repeatMode": repeatMode,
      "fullPlayback": fullPlayback
    ]
    snapshotLock.lock()
    snapshot = next
    snapshotLock.unlock()
  }

  private func updateNowPlaying() {
    guard tracks.indices.contains(index) else { return }
    let track = tracks[index]
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: track.title,
      MPMediaItemPropertyArtist: track.artist,
      MPMediaItemPropertyPlaybackDuration: track.durationMs / 1000,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: currentPositionMs / 1000,
      MPNowPlayingInfoPropertyPlaybackRate: player.rate
    ]
    if let album = track.album { info[MPMediaItemPropertyAlbumTitle] = album }
    if let persistentID = UInt64(track.id) {
      let query = MPMediaQuery.songs()
      query.addFilterPredicate(MPMediaPropertyPredicate(
        value: NSNumber(value: persistentID),
        forProperty: MPMediaItemPropertyPersistentID
      ))
      if let artwork = query.items?.first?.artwork {
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(
          boundsSize: CGSize(width: 300, height: 300)
        ) { size in
          artwork.image(at: size) ?? UIImage()
        }
      }
    }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func updateElapsedNowPlaying() {
    guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPositionMs / 1000
    info[MPNowPlayingInfoPropertyPlaybackRate] = player.rate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func saveQueue(key: String) {
    let savedTracks = tracks.map {
      SavedTrack(
        id: $0.id,
        uri: $0.uri,
        title: $0.title,
        artist: $0.artist,
        album: $0.album,
        durationMs: $0.durationMs,
        artworkUri: $0.artworkUri
      )
    }
    guard let data = try? JSONEncoder().encode(SavedQueue(key: key, tracks: savedTracks)) else { return }
    UserDefaults.standard.set(data, forKey: defaultsKey)
  }

  private func savedTrackDictionary(_ track: SavedTrack) -> [String: Any] {
    [
      "id": track.id,
      "uri": track.uri,
      "title": track.title,
      "artist": track.artist,
      "album": track.album ?? NSNull(),
      "durationMs": track.durationMs,
      "artworkUri": track.artworkUri ?? NSNull()
    ]
  }

  private func tearDown() {
    DispatchQueue.main.async {
      if let observer = self.timeObserver { self.player.removeTimeObserver(observer) }
      self.timeObserver = nil
      if let observer = self.endObserver { NotificationCenter.default.removeObserver(observer) }
      self.endObserver = nil
      if let observer = self.failureObserver { NotificationCenter.default.removeObserver(observer) }
      self.failureObserver = nil
      if let observer = self.interruptionObserver { NotificationCenter.default.removeObserver(observer) }
      self.interruptionObserver = nil
      if let observer = self.routeChangeObserver { NotificationCenter.default.removeObserver(observer) }
      self.routeChangeObserver = nil
      self.remoteTargets.forEach { $0.0.removeTarget($0.1) }
      self.remoteTargets.removeAll()
      self.player.pause()
    }
  }
}
