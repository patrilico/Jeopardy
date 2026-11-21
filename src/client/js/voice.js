// Play recordings saved with the game. If one has not been prepared yet,
// use an English voice installed on this device when the browser exposes one.
window.playVoiceOver = function playVoiceOver(url, text, onComplete) {
  let finished = false;
  let fallbackStarted = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onComplete();
  };

  const useLocalVoice = () => {
    if (finished || fallbackStarted) return;
    fallbackStarted = true;
    if (!text || !('speechSynthesis' in window)) return finish();
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.localService && /^en[-_]/i.test(voice.lang));
    const voice = voices.find(item => /david|guy|mark|brian|daniel/i.test(item.name)) || voices[0];
    if (!voice) return finish();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  };

  if (!url) return useLocalVoice();
  const recording = new Audio(url);
  recording.addEventListener('ended', finish, { once: true });
  recording.addEventListener('error', useLocalVoice, { once: true });
  recording.play().catch(useLocalVoice);
};
