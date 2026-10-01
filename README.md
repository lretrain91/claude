# Musicalité

Un résumé simple et visuel de la construction d'un morceau.

Ouvre `musicalite/` sur ton téléphone, touche **Écouter** et mets ta musique à côté
(ou analyse un fichier audio). Le micro demande une page en `https://` (GitHub Pages) :
https://lretrain91.github.io/claude/musicalite/

- **La frise du morceau**, dessinée au fil de l'écoute : une ligne par phrase
  (4 × 8 temps), un trait par temps ; le grand 1 de chaque phrase (trait blanc) et le 1 de
  chaque 8 temps sont plus grands, et tous les 1 sont alignés d'une ligne à l'autre.
  Couleur = section, intensité = énergie ; les moments clés sont marqués au temps près
  (‖ break, ▲ drop, ↗ montée, T tag, ~ basse coupée, ● hit) et les temps d'un tag
  dépassent en bout de ligne.
- **La forme** en lettres, par exemple `A B A B C B` : les sections qui se ressemblent
  reçoivent la même lettre.
- En direct : tempo, feeling (swing ou droit), compte de 1 à 8, position dans la phrase.
  Rien ne s'affiche tant qu'on n'entend pas un rythme franc (bruit de la pièce, voix) ;
  le morceau commence à l'entrée réelle de la musique.
  « Taper le 1 » et « Début de phrase » recalent les comptes si besoin.
- Bilan : la frise s'enregistre en image, le résumé se copie en texte, et le détail
  complet se télécharge en JSON.

Sur Chrome (Android compris), le micro est lu directement, sans moteur audio : la page ne
produit aucun son, ce qui évite de couper la musique d'une autre appli (Android Auto, Bluetooth).
Si la musique se coupe quand même au lancement, l'appli le signale : relance-la, l'écoute continue.

Les sections, comptes et moments sont estimés à partir de l'énergie du son dans
4 bandes de fréquence : fiables sur des musiques au rythme marqué, à vérifier à l'oreille.

**Les 1 et les grands 1.** Le calage est recalculé tous les 4 temps sur tout ce qui a été
entendu : pour chacune des 32 places possibles du grand 1, l'appli additionne les indices qui
tombent au bon endroit (changements de son ou d'énergie, drops, reprises, entrée ou sortie de la
basse, fills juste avant, changements de notes, attaques, grosse caisse sur 1 et 3 / caisse
claire sur 2 et 4) et garde la plus cohérente. Si l'écoute a commencé en cours de morceau, le
grand 1 ne peut se déduire qu'au prochain changement : l'appli affiche « Phrase ? » pendant les
deux premières phrases ; le compte de 1 à 8 reste affiché.

## Apprendre sur ta musique (ordinateur)

Sur PC, avec Chrome ou Edge : ouvre ta playlist sur open.spotify.com, puis dans Musicalité
« Écouter l'onglet Spotify » (choisis l'onglet et coche « Partager aussi l'audio de l'onglet » ;
la musique continue de jouer normalement). Pendant l'écoute, tape en rythme :
**Espace** sur chaque temps, **1** sur chaque 1, **Entrée** sur chaque grand 1.
En fin d'écoute, « Données d'apprentissage » télécharge un fichier (empreinte rythmique +
taps, sans l'audio) à déposer dans le dossier `apprentissage/` du dépôt.
`outils/evaluer.html` compare l'analyse à tes taps.

## Code

- `js/analysis.js` : bandes de fréquence, attaques, tempo, lecture du micro.
- `js/musicality.js` : analyse de musicalité (comptes, phrases, calage des grands 1, sections, événements, bilan).
- `musicalite/` : interface de l'appli (web app installable), dont `map.js` pour la frise.
- `outils/evaluer.html` : rejoue des données d'apprentissage et note l'analyse par rapport aux taps.
