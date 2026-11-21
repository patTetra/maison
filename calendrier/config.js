// Réglages de l'agenda (pas de secret ici : l'adresse du script et le code d'accès sont saisis au premier lancement)
window.CONFIG = {
  TITRE: "Agenda",
  SCRIPT_URL: "",          // vide = demandé au premier lancement puis mémorisé sur l'appareil
  DEBUT_SEMAINE: 1,        // 1 = lundi, 0 = dimanche
  NUMEROS_SEMAINES: true,  // numéros de semaine à gauche du mois
  DUREE_DEFAUT_MIN: 60,    // durée proposée pour un nouvel événement
  HEURE_DEFAUT: 9,         // heure proposée si le jour choisi n'est pas aujourd'hui
  CACHE_SECONDES: 60       // pas de nouvel appel Google avant ce délai
};
