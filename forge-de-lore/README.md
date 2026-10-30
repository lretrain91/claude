# Forge de Lore

Outil de création de lore pour jeu vidéo, propulsé par l'IA générative (Claude).

- **Univers** : nom, pitch, chronologie en 4 époques, factions rivales, à partir d'un genre, d'un ton et d'une idée de départ.
- **Lieux, personnages, histoires** : génération cohérente avec le monde existant, fiches modifiables, bouton « Approfondir », liens automatiques entre éléments.
- **Carte interactive** : une carte du monde générée pour chaque univers (côtes, montagnes, forêts, marais), navigable comme Maps. Les lieux y apparaissent avec la miniature de leur visuel, entourés des portraits des personnages qui en sont originaires. Toucher un lieu permet de lui rattacher des personnages comme lieu d'origine ; toucher une zone vide permet d'y fonder un lieu, créé à la main ou par l'IA selon le terrain et les voisins.
- **Illustrations** : un prompt d'image prêt pour Midjourney, DALL·E ou Stable Diffusion pour chaque élément (avec un style visuel global), et une esquisse vectorielle SVG dessinée par Claude.
- **Thèmes graphiques** : 8 thèmes classiques (pixel art, aquarelle, gravure, cel-shading, low poly, peinture sombre, synthwave, sumi-e), 4 thèmes proposés par l'IA pour le monde en cours, ou un thème déduit d'images de référence importées (style, palette, technique). Le thème s'applique aux prompts d'image et aux esquisses ; les images de référence accompagnent chaque esquisse.
- **Illustrations FLUX** : bouton « Générer l'illustration » sur chaque élément, peint par FLUX Krea, Z-Image Turbo ou FLUX Schnell via le connecteur Hugging Face de Claude (URL `https://huggingface.co/mcp?gradio=mcp-tools/FLUX.1-Krea-dev`), en suivant le thème graphique et la palette du monde.
- **Cohérence visuelle** : une direction artistique par monde (texte de style identique en fin de chaque prompt, modifiable) et une graine commune ; une signature visuelle fixe par personnage, créature, peuple et lieu, reprise dans chaque image ; les scènes d'histoire reprennent l'apparence des personnages et lieux impliqués.
- **Images** : chaque lieu, personnage, histoire et le monde lui-même peuvent recevoir une vraie image (importée depuis Midjourney, DALL·E, etc.), qui remplace l'esquisse sur les fiches, la carte et la galerie.
- **Système de jeu propre à l'univers** (onglet Règles) : source de pouvoir, classes et peuples tirés du lore (aucune classe standard de D&D), modifiables.
- **Bestiaire** : créatures (bloc de statistiques D&D 5e, habitat, légendes, butin), peuples (culture, apparence, terre natale, longévité, langues, traits raciaux, synchronisés avec les règles) et objets / artefacts (rareté, pouvoirs, histoire, détenteur, malédiction), liés aux lieux et personnages, illustrables et inclus dans la bible exportée.
- **Fiches de personnage par époque** : fiche D&D 5e (niveau, classe et peuple du monde, caractéristiques, PV, CA, compétences, capacités, équipement) avec une version par époque et ce qui a changé ; les dialogues s'en servent pour fixer la difficulté des jets.
- **Archiviste** (onglet Cohérence) : agent qui relit les conversations et tous les textes du monde, repère les créatures, personnages, lieux, objets, peuples et factions mentionnés mais absents, et crée leurs fiches (automatiquement à la fermeture de chaque conversation, ou en relecture complète). Chaque création entre dans une file chronologique « À valider » (citation déclencheuse, source) : valider la garde, rejeter la retire du monde ; historique conservé. L'archiviste propose aussi des approfondissements (secrets, rivalités, coutumes, liens) sur tout le monde ou une fiche précise, appliqués seulement après validation, avec l'aperçu de ce qui change.
- **Gardien de cohérence** : Claude relit tout le monde, liste contradictions, trous et éléments isolés, et « Combler » écrit directement les ajouts ou corrections nécessaires.
- **Dialogue avec les personnages** : discussion en direct avec un personnage, dans sa voix, avec ses secrets protégés ou non ; l'historique est conservé. Jets de d20 façon Donjons et Dragons : le personnage demande un jet (Persuasion, Tromperie, Intimidation, Perspicacité, Investigation, Marchandage) avec une difficulté (DD) quand l'issue est incertaine, le joueur ajoute ses bonus, et la réponse suit le résultat (réussites et échecs critiques compris). Création de personnage depuis la conversation : `/create` (son propre personnage), `/create <description>` (quelqu'un d'autre), bouton « + Perso » ou demande hors-jeu en langage naturel ; le personnage du joueur fournit ensuite ses bonus de jets.
- **Export** : bible du monde en Markdown, sauvegarde JSON réimportable.

- **Onglet Univers** : le résumé complet du monde (pitch, chronologie, factions, image) ; en haut de page ne reste qu'une ligne compacte.

## Utilisation

La génération par IA fonctionne quand la page est ouverte comme artifact dans Claude (capacités `sample`, `db`, `user`, `downloads`).
Ouverte ailleurs (GitHub Pages, fichier local), la page affiche le monde d'exemple et permet la consultation, l'édition et l'import/export, mais sans génération.
