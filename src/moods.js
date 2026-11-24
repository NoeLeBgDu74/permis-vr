// Humeurs de l'inspecteur : ton, débit de parole, sévérité, indulgence, bavardage.
// forgive : probabilité d'accorder une faute légère ; speedTol : tolérance (km/h) avant « vitesse excessive » ;
// slowAfter : secondes de lenteur avant « manque d'allure » ; blindSpot : chance de ne pas remarquer un oubli de contrôle.
export const MOODS = {
  jovial: {
    label: 'de très bonne humeur', emoji: '😄', rate: 1.0, forgive: 0.5, speedTol: 6, slowAfter: 16, blindSpot: 0.15, chat: 70,
    persona: 'Tu es de très bonne humeur aujourd\'hui : chaleureux, blagueur, encourageant, tu tutoies presque (mais tu vouvoies).',
    hello: ['Bonjour bonjour ! Belle journée pour conduire, non ? Installez-vous tranquillement.', 'Ah, bonjour ! Détendez-vous, ça va très bien se passer.'],
    forgiveLines: ['Allez, celle-là je vous l\'accorde.', 'Bon, je ferme les yeux pour cette fois.', 'Je n\'ai rien vu, on continue !'],
    chatLines: ['Vous savez, j\'ai passé mon permis trois fois. Alors vous êtes déjà meilleur que moi !', 'Joli quartier, hein ? Ma boulangère habite par là.', 'Respirez, vous conduisez bien.', 'Vous aimez la musique ? Moi je chante dans ma voiture, mais pas pendant les examens.'],
    pass: 'Bravo ! Vraiment, félicitations, vous l\'avez mérité !', fail: 'Ce n\'est que partie remise, vous allez l\'avoir la prochaine fois, j\'en suis sûr.',
  },
  strict: {
    label: 'strict et pointilleux', emoji: '🧐', rate: 1.0, forgive: 0, speedTol: 2, slowAfter: 10, blindSpot: 0, chat: 0,
    persona: 'Tu es strict, froid et pointilleux : phrases courtes, aucune familiarité, tu rappelles le règlement.',
    hello: ['Bonjour. Pièce d\'identité vérifiée. Nous commençons. Je note tout.', 'Bonjour. Soyez attentif, je ne laisse rien passer.'],
    forgiveLines: [], chatLines: [],
    pass: 'Résultat favorable. Restez prudent.', fail: 'Résultat défavorable. Revoyez les fondamentaux.',
  },
  presse: {
    label: 'pressé', emoji: '⌚', rate: 1.14, forgive: 0.15, speedTol: 4, slowAfter: 7, blindSpot: 0.1, chat: 90,
    persona: 'Tu es pressé, tu regardes ta montre, tu parles vite et tu veux que ça avance.',
    hello: ['Bonjour, on y va, on y va, j\'ai encore six candidats après vous.', 'Bonjour. Allez, on démarre, on n\'a pas toute la journée.'],
    forgiveLines: ['Bon, pas le temps de chipoter, on continue.'],
    chatLines: ['Allez, on avance un peu.', 'Hmm, il est déjà cette heure-là…', 'On ne traîne pas, s\'il vous plaît.'],
    pass: 'C\'est bon, c\'est réussi, au revoir !', fail: 'C\'est non pour aujourd\'hui. Suivant !',
  },
  bavard: {
    label: 'bavard', emoji: '🗣️', rate: 1.04, forgive: 0.3, speedTol: 4, slowAfter: 13, blindSpot: 0.25, chat: 35,
    persona: 'Tu es très bavard : tu racontes des anecdotes, tu commentes tout, mais tu restes juste.',
    hello: ['Bonjour ! Alors, vous êtes d\'ici ? Moi je fais ce métier depuis vingt-deux ans, vous savez.', 'Bonjour ! Ah, cette voiture, j\'en ai vu passer des candidats dedans !'],
    forgiveLines: ['Bon, on va dire que je regardais la boulangerie à ce moment-là.', 'Oh, ça arrive à tout le monde, je ne le compte pas.'],
    chatLines: ['Vous savez qu\'avant, il n\'y avait pas de rond-point ici ? Que des feux !', 'Mon neveu passe son permis le mois prochain, il est terrorisé.', 'Le meilleur conseil que je donne : regarder loin devant.', 'Il paraît qu\'il va encore pleuvoir ce week-end.', 'Un jour, un candidat a confondu le frein et l\'accélérateur. On a fini dans une haie !'],
    pass: 'Félicitations ! Vous me ferez signe quand vous aurez votre première voiture !', fail: 'Dommage ! Mais je vous assure, la deuxième fois, c\'est la bonne.',
  },
  grincheux: {
    label: 'grincheux', emoji: '😒', rate: 0.97, forgive: 0.05, speedTol: 3, slowAfter: 11, blindSpot: 0.05, chat: 110,
    persona: 'Tu es grincheux : tu soupires, tu râles contre la circulation et la météo, mais tu restes correct et juste.',
    hello: ['Bonjour… Bon. Allons-y, finissons-en.', 'Pff. Bonjour. Et faites attention à mes genoux en freinant.'],
    forgiveLines: ['Bon… je laisse passer. Mais c\'est bien parce que c\'est vous.'],
    chatLines: ['Pff, ces travaux partout…', 'Encore ce feu qui dure une éternité.', 'Mon café était froid ce matin.'],
    pass: 'Mouais. C\'est bon. Vous l\'avez.', fail: 'Non. Pas aujourd\'hui.',
  },
  fatigue: {
    label: 'fatigué', emoji: '🥱', rate: 0.9, forgive: 0.35, speedTol: 5, slowAfter: 15, blindSpot: 0.45, chat: 100,
    persona: 'Tu es fatigué, tu bâilles, tu parles lentement, tu es indulgent mais un peu distrait.',
    hello: ['Bonjour… pardon, nuit difficile. Allez-y quand vous voulez.', 'Bonjour… ahhh… pardon, on commence.'],
    forgiveLines: ['Hmm… je n\'ai pas bien vu, on continue.', 'Bon… je ne vais pas noter ça.'],
    chatLines: ['Ahhh… pardon.', 'Il fait bon dans cette voiture… trop bon.', 'Vous ne trouvez pas que ce siège est confortable ?'],
    pass: 'C\'est… réussi. Bravo. Je vais aller dormir.', fail: 'C\'est raté… désolé. Reposez-vous, moi aussi.',
  },
};
export const MOOD_KEYS = Object.keys(MOODS);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomMood() { return pick(MOOD_KEYS); }
