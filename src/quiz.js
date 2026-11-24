// Questions de l'épreuve pratique : vérifications (intérieur / extérieur), sécurité routière, premiers secours.
// [question, [réponse 1, 2, 3], index de la bonne réponse, explication courte]
export const VERIF = [
  ['Comment vérifiez-vous la pression des pneus ?', ['En tapant dans le pneu avec le pied', 'Avec un manomètre, pneus froids, selon la notice', 'En regardant s\'il est un peu écrasé'], 1, 'On la contrôle à froid, avec un manomètre, aux valeurs indiquées par le constructeur.'],
  ['Que signifie un voyant rouge qui s\'allume en roulant ?', ['Une alerte : il faut s\'arrêter dès que possible', 'Un simple rappel d\'entretien', 'Que les phares sont allumés'], 0, 'Rouge, c\'est une alerte : on s\'arrête en sécurité au plus vite.'],
  ['Où contrôle-t-on le niveau du liquide de frein ?', ['Sur la jauge à huile', 'Dans le réservoir transparent sous le capot, entre mini et maxi', 'Sur le tableau de bord uniquement'], 1, 'Le réservoir est sous le capot, le niveau doit être entre les repères mini et maxi.'],
  ['À quoi servent les feux de brouillard arrière ?', ['À être vu par temps de brouillard ou de neige', 'À éclairer la route en marche arrière', 'À signaler un freinage'], 0, 'Uniquement par brouillard ou neige, sinon ils éblouissent.'],
  ['Quelle est la profondeur minimale légale des sculptures d\'un pneu ?', ['0,5 millimètre', '1,6 millimètre', '5 millimètres'], 1, 'Le minimum légal est de 1,6 millimètre.'],
  ['Comment désembuer le pare-brise rapidement ?', ['Ventilation vers le pare-brise, climatisation et air chaud', 'Ouvrir le toit ouvrant', 'Essuyer avec la main'], 0, 'Air dirigé vers le pare-brise, climatisation activée : c\'est le plus efficace.'],
  ['Quand doit-on utiliser les feux de route ?', ['En ville la nuit', 'Hors agglomération la nuit, sans éblouir personne', 'Par temps de pluie le jour'], 1, 'Hors agglomération, la nuit, et on repasse en croisement face à un autre usager.'],
  ['Quelle distance de sécurité minimale sur autoroute ?', ['Une seconde', 'Deux secondes, soit deux traits de la bande d\'arrêt d\'urgence', 'Dix mètres'], 1, 'Au moins deux secondes, c\'est-à-dire deux traits de la bande d\'arrêt d\'urgence.'],
];
export const SECOURS = [
  ['Quel numéro d\'urgence européen pouvez-vous appeler ?', ['Le 112', 'Le 3615', 'Le 118 218'], 0, 'Le 112 fonctionne partout dans l\'Union européenne.'],
  ['Sur un accident, quelle est la première chose à faire ?', ['Déplacer les blessés', 'Protéger : baliser et éviter un sur-accident', 'Donner à boire aux victimes'], 1, 'Protéger, alerter, secourir : on commence par protéger les lieux.'],
  ['Une victime ne répond pas mais respire. Que faites-vous ?', ['Je la mets en position latérale de sécurité', 'Je lui fais un massage cardiaque', 'Je la laisse sur le dos sans rien faire'], 0, 'Elle respire : position latérale de sécurité, puis on alerte et on surveille.'],
  ['Pourquoi ne faut-il pas retirer le casque d\'un motard blessé ?', ['Parce que c\'est interdit par la loi', 'Pour ne pas aggraver une éventuelle lésion de la colonne', 'Parce qu\'il protège du froid'], 1, 'On risque d\'aggraver une lésion de la colonne vertébrale.'],
  ['Quelles informations donner aux secours ?', ['Seulement mon nom', 'Le lieu précis, le nombre de victimes et leur état', 'La marque des voitures'], 1, 'Lieu précis, nombre de victimes, état apparent : c\'est l\'essentiel.'],
];
export function pickQuestions() {
  const a = VERIF[Math.floor(Math.random() * VERIF.length)], b = SECOURS[Math.floor(Math.random() * SECOURS.length)];
  return [a, b];
}
