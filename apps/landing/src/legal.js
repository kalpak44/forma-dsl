/**
 * The entry point for the privacy and terms sheets: the shell, and nothing else.
 *
 * Deliberately separate from the landing page's entry so that reading the policy does not
 * download a renderer and a geometry kernel to look at a page of prose.
 */

import './styles.css';

import { initSite } from './site.js';

initSite();
