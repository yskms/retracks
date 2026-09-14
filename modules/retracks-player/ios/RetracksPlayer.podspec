Pod::Spec.new do |s|
  s.name           = 'RetracksPlayer'
  s.version        = '1.0.0'
  s.summary        = 'Native audio player for RE:TR4CKS'
  s.description    = 'Queue, segment playback and lock-screen controls for RE:TR4CKS.'
  s.license        = { :type => 'MIT' }
  s.author         = 'RE:TR4CKS'
  s.homepage       = 'https://example.invalid/retracks'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://example.invalid/retracks.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'AVFoundation', 'MediaPlayer'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
