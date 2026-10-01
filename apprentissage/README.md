# Données d'apprentissage

Dépose ici les fichiers `apprentissage-….json.gz` exportés par Musicalité
(bouton « Données d'apprentissage » en fin d'écoute).

Chaque fichier contient :
- l'empreinte rythmique mesurée pendant l'écoute (énergie et taux de passage par zéro de
  4 bandes de fréquence, environ 86 fois par seconde) — pas l'audio lui-même ;
- les taps : `temps` (Espace), `1` (touche 1), `grand1` (Entrée = début de phrase) ;
- l'analyse faite pendant l'écoute.

`outils/evaluer.html` rejoue ces fichiers dans la version actuelle de l'analyse et la note
par rapport aux taps. Note, si tu peux, la playlist ou les titres écoutés dans le message
du dépôt.
