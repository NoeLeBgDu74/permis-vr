// Répliques naturelles de l'inspecteur quand il remarque quelque chose (l'écran garde l'intitulé officiel de la faute).
export const TALK = {
  blink: ['Et le clignotant ? On prévient les autres avant de tourner.', 'Vous avez oublié votre clignotant, là.', 'Pensez à clignoter avant de tourner, hein.'],
  blinkStart: ['Vous partez sans clignotant ? Les autres ne lisent pas dans vos pensées.', 'Avant de quitter le trottoir, on met son clignotant.'],
  mirror: ['Vous n\'avez pas jeté un œil à vos rétros avant de tourner.', 'Un petit regard dans le rétro avant de tourner, toujours.', 'Les rétroviseurs, ce n\'est pas de la décoration !'],
  blind: ['Vous n\'avez pas tourné la tête pour l\'angle mort en partant.', 'L\'angle mort ! Un cycliste aurait pu être là.'],
  speed: ['On lève un peu le pied, vous êtes au-dessus de la limite.', 'Attention, regardez votre compteur, c\'est trop vite.', 'Doucement, doucement… la vitesse.'],
  left: ['Serrez à droite, vous êtes trop au milieu.', 'Restez bien dans votre voie, sur la droite.'],
  curb: ['Aïe, le trottoir !', 'Oups, on est monté sur le trottoir.', 'Attention aux bordures, là.'],
  orange: ['C\'était orange, il fallait vous arrêter.', 'Hmm, l\'orange, ça veut dire stop si on peut.'],
  park: ['Vous êtes un peu loin du trottoir, là.', 'Il fallait vous garer plus près du bord.'],
  brake: ['Oh là, doucement ! J\'ai failli avaler ma planchette.', 'Hop hop hop, pas si fort sur le frein !', 'Freinez plus en douceur, il n\'y avait pas de danger.'],
  slow: ['Vous pouvez accélérer un peu, la route est libre.', 'N\'hésitez pas, avancez, on gêne derrière.'],
  blinkExit: ['En sortant du rond-point, clignotant à droite, s\'il vous plaît.', 'Et le clignotant droit pour sortir ?'],
  creneau: ['Bon… ce créneau n\'est pas vraiment réussi.', 'Hmm, la voiture n\'est pas bien dans la place.'],
  creneauAvant: ['Un créneau, ça se fait en marche arrière, normalement.'],
  touch: ['Ouh ! Vous avez touché la voiture garée.', 'Aïe, on a frotté, là.'],
  blinkLane: ['Clignotant pour changer de voie, s\'il vous plaît.', 'Vous changez de file sans prévenir, attention.'],
  keepRight: ['Rabattez-vous à droite, la voie est libre.', 'On ne reste pas à gauche sans raison.'],
  distance: ['Vous êtes trop collé à celui de devant, gardez vos distances.', 'Laissez plus d\'espace devant vous, au moins deux secondes.'],
  stopHW: ['On ne ralentit pas comme ça sur l\'autoroute, c\'est dangereux.'],
  bau: ['Vous êtes sur la bande d\'arrêt d\'urgence, revenez sur la voie !'],
  insertion: ['Il fallait accélérer davantage pour vous insérer.', 'Sur la bretelle, on prend de la vitesse avant de s\'insérer.'],
  // éliminatoires
  red: ['Stop ! Le feu était rouge !', 'Mais… c\'était rouge !'],
  stop: ['Vous n\'avez pas marqué l\'arrêt au stop. Il faut s\'arrêter complètement.', 'Le stop ! Les roues doivent s\'arrêter totalement.'],
  priority: ['Attention ! Vous deviez le laisser passer !', 'Holà, il avait la priorité !'],
  ped: ['Le piéton ! Vous deviez le laisser traverser !'],
  crash: ['Aïe ! On a touché !', 'Oh non… le choc !'],
  wrongway: ['Mais… vous êtes à contresens !'],
  bigspeed: ['Beaucoup trop vite ! Ralentissez tout de suite !'],
};
export const ELIM_END = ['Je suis désolé, c\'est éliminatoire. L\'examen s\'arrête là, garez-vous dès que possible.', 'Bon… je dois arrêter l\'examen ici. Arrêtez-vous quand vous pourrez.'];
export const FREE_ELIM = ['À l\'examen, ça, c\'est éliminatoire, hein.', 'Le jour J, ça vous coûterait le permis.'];
// probabilité que l'inspecteur réagisse à voix haute à une faute légère pendant l'examen, selon son humeur
export const REACT = { jovial: 0.75, strict: 0.35, presse: 0.5, bavard: 0.9, grincheux: 0.6, fatigue: 0.4 };
