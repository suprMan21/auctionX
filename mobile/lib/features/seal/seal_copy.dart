/// Creator-facing words for sealing. Brand Voice draft from the Ideas DB row "Recorded sealing"
/// (2026-10-26) plus the S-MOB2 additions: not on metal, press firmly, turn off music, don't ship for 24 h.
/// Customers see "seal", never token or chip (Locked 2026-10-28).
library;

import 'data/seal_reader.dart';
import 'data/seal_tap.dart';

class PrepPoint {
  const PrepPoint(this.title, this.body);
  final String title;
  final String body;
}

const prepTitle = 'BEFORE YOU SEAL.';
const prepIntro = 'This is the moment your piece becomes AM Sealed. Once you confirm, the seal and its video are '
    'permanent. Take a minute to get ready.';

const prepPoints = [
  PrepPoint('Have it in front of you.',
      'The piece, the seal, a clean dry surface. The seal goes on the piece itself, not the packaging, and across '
      'any seam or opening.'),
  PrepPoint('Not on metal.', 'The seal won’t read on metal. Pick a spot on fabric, paper, wood or plastic.'),
  PrepPoint('Press firmly.', 'Rub the whole seal down for a few seconds so it sticks everywhere.'),
  PrepPoint('Know your story.', 'Who you are, what this is, where it came from, why it matters.'),
  PrepPoint('Check your frame.', 'Everyone who taps this seal sees this video. Mind what’s behind you.'),
  PrepPoint('Turn off music.', 'Songs playing in the background belong to someone else. Keep them off so your video '
      'can stay up.'),
  PrepPoint('One seal, one shot.', 'A seal can only be applied once. If it tears, it won’t read again.'),
  PrepPoint('One take, start to finish.',
      'Tap the loose seal to start. After 3, 2, 1 the recording runs until you tap the seal again, '
      'up to 2 minutes.'),
  PrepPoint('Wait a day before shipping.', 'The seal needs 24 hours to set before the piece travels.'),
];

const prepPractice = 'Want a practice run first? It doesn’t use your seal.';
const prepAfter = 'You can watch your video before you confirm. After you confirm, it’s sealed for good.';

const tap1Prompt = 'Hold the top of your phone to the loose seal';
const tap1PromptRedo = 'Hold the top of your phone to the seal on the piece';
const tap2Prompt = 'Hold the top of your phone to the seal on the piece';

String readFailureCopy(Object error) {
  if (error is SealReadException) {
    return switch (error.failure) {
      SealReadFailure.unavailable => 'NFC is off or not available on this phone. Turn it on in Settings and try again.',
      SealReadFailure.cancelled => 'The seal wasn’t read. Try again when you’re ready.',
      SealReadFailure.nothingRead => 'That didn’t read as a seal. Hold the phone still on the seal and try again.',
    };
  }
  if (error is SealTapException) {
    return switch (error.problem) {
      SealTapProblem.notASeal => 'That isn’t an Authentic Materials seal.',
      SealTapProblem.oldChip => 'This seal is an older kind that can’t be sealed in the app. '
          'Contact us at hello@authentic-materials.com.',
    };
  }
  return 'The seal wasn’t read. Try again.';
}
