# Forge de Lore

Outil de création de lore pour jeu vidéo, propulsé par l'IA générative (Claude).

- **Univers** : nom, pitch, chronologie en 4 époques, factions rivales, à partir d'un genre, d'un ton et d'une idée de départ.
- **Lieux, personnages, histoires** : génération cohérente avec le monde existant, fiches modifiables, bouton « Approfondir », liens automatiques entre éléments.
- **Carte interactive** : une carte du monde générée pour chaque univers (côtes, montagnes, forêts, marais), navigable comme Maps. Les lieux y apparaissent avec la miniature de leur visuel, entourés des portraits des personnages qui en sont originaires. Toucher un lieu permet de lui rattacher des personnages comme lieu d'origine ; toucher une zone vide permet d'y fonder un lieu, créé à la main ou par l'IA selon le terrain et les voisins.
- **Illustrations** : un prompt d'image prêt pour Midjourney, DALL·E ou Stable Diffusion pour chaque élément (avec un style visuel global), et une esquisse vectorielle SVG dessinée par Claude.
- **Export** : bible du monde en Markdown, sauvegarde JSON réimportable.

## Utilisation

La génération par IA fonctionne quand la page est ouverte comme artifact dans Claude (capacités `sample`, `db`, `user`, `downloads`).
Ouverte ailleurs (GitHub Pages, fichier local), la page affiche le monde d'exemple et permet la consultation, l'édition et l'import/export, mais sans génération.
