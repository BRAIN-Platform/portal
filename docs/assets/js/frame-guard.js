// clickjacking guard
try {
  if (window.top !== window.self) {
    window.top.location = window.self.location;
  }
} catch (_) { }

