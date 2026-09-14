# Cahier des charges — Plateforme de fiche de révision EDN

## 1. Contexte et objectif

La copine de Clément prépare les EDN (examens nationaux de médecine) et tient actuellement une fiche de révision qu'elle relit juste avant les épreuves. L'objectif est de lui fournir une plateforme simple lui permettant :

- d'ajouter des informations à sa fiche **sans avoir à les rédiger proprement** (pas de contrainte de mise en forme au moment de la saisie),
- de voir sa fiche se structurer et se mettre à jour automatiquement,
- d'y accéder n'importe quand, depuis n'importe quel appareil, de façon persistante.

## 2. Principe retenu

Une IA (Claude Sonnet) est utilisée pour :
- classer chaque information saisie dans la bonne catégorie (UE / item du programme EDN),
- reformuler/structurer le contenu brut en une entrée de fiche lisible,
- fusionner l'information avec le contenu existant de la fiche sans dupliquer ce qui est déjà noté.

Une saisie 100% structurée (formulaire classique sans IA) reste une alternative plus simple et plus fiable, mais ne permet pas la saisie en langage libre — c'est le confort principal apporté par l'IA ici.

**Point de départ** : le projet ne part pas d'une fiche vide. Une fiche existante (déjà tenue par elle, organisée par spécialité puis par notion clé, avec un format à deux colonnes « Notion clé / Ce qu'il faut retenir », des tableaux comparatifs, des moyens mnémotechniques et quelques schémas/algorithmes sous forme d'images) doit pouvoir être **importée** dans la plateforme au démarrage. C'est cette fiche importée qui sera ensuite complétée au fil des ajouts.

## 3. Architecture technique retenue

- **Type de solution** : Artifact Claude (application intégrée à Claude.ai), et non un site web indépendant hébergé ailleurs.
- **Appel IA** : l'artifact appelle directement l'API Anthropic (modèle Sonnet) depuis son code, sans clé API à gérer et sans facturation séparée.
- **Stockage** : stockage persistant intégré aux artifacts (clé-valeur), en mode **personnel** (visible uniquement par elle, pas partagé publiquement).
- **Compte utilisé** : le compte Claude personnel de la copine de Clément (déjà en formule Pro). Les appels IA consomment donc les limites d'usage de **son** compte à elle — il n'existe pas de mécanisme pour faire porter la consommation sur un autre compte (ex. le forfait Max de Clément) indépendamment de qui utilise l'artifact.

## 4. Contraintes et limites connues

- L'artifact ne fonctionne que dans l'environnement Claude.ai (pas de nom de domaine propre, pas d'hébergement indépendant).
- Pas de vraie base de données externe — le stockage reste celui, simple, fourni par le système d'artifacts.
- La consommation estimée de la limite d'usage Pro reste marginale pour un usage normal (quelques ajouts par jour) ; le principal risque de surconsommation viendrait d'un renvoi systématique de l'intégralité de la fiche à chaque appel IA (à éviter en ne transmettant que le contexte pertinent, ex. la section concernée).
- Si un usage plus intensif ou un produit autonome est envisagé plus tard, il faudrait passer par l'API Anthropic classique avec des crédits facturés à l'usage (hors artifact).

## 5. Fonctionnalités attendues

1. **Import de la fiche existante** : au démarrage, possibilité de charger sa fiche actuelle (contenu déjà organisé par spécialité/notion) pour servir de base à compléter — pas de ressaisie manuelle du travail déjà fait.
2. **Saisie libre, au clavier ou à la voix** : deux modes de saisie possibles pour chaque ajout — texte tapé (ou collé), ou dictée orale. La dictée doit fonctionner sur Safari (navigateur utilisé par elle) ; à vérifier techniquement, car la reconnaissance vocale native de Safari est limitée/peu fiable — une solution alternative consisterait à enregistrer l'audio dans le navigateur puis à le transcrire via un appel IA plutôt que de dépendre de l'API de reconnaissance vocale native de Safari.
3. **Classification automatique** : l'IA identifie la spécialité/notion clé concernée, en se basant sur la structure et la granularité déjà utilisées dans la fiche importée (organisation par spécialité puis par notion, telle qu'observée dans la fiche de référence — le niveau de détail exact sera calé sur cette fiche, qui peut elle-même évoluer d'ici le développement).
4. **Structuration automatique** : l'IA reformule l'information en une entrée claire et concise, cohérente avec le style du reste de la fiche (texte, tableau comparatif, ou moyen mnémotechnique selon ce qui convient le mieux, à l'image du format déjà utilisé).
5. **Fusion sans doublon** : l'IA vérifie si une entrée proche existe déjà pour cette notion et la complète/actualise plutôt que de la dupliquer.
6. **Règle stricte anti-erreur** : si l'IA hésite (classement incertain, information ambiguë, risque d'erreur dans le contenu ou dans la mise en forme), **elle n'écrit rien du tout** — ni approximation, ni tentative de classement par défaut. Aucune fausse information ne doit jamais apparaître dans la fiche, que ce soit dans le contenu médical ou dans sa présentation.
7. **Consultation de la fiche** : vue organisée par spécialité puis par notion, consultable et parcourable facilement (utile pour la relecture avant l'examen).
8. **Édition manuelle** : possibilité de corriger ou modifier directement une entrée sans repasser par l'IA, si besoin.
9. **Persistance** : toutes les données restent disponibles d'une session à l'autre, sans réinitialisation.

## 6. Points restant à trancher

- Format exact du fichier/contenu à importer pour la fiche existante (à confirmer selon le support utilisé au moment du développement).
- Solution technique retenue pour la dictée vocale sous Safari (API native du navigateur vs. enregistrement + transcription via IA).
