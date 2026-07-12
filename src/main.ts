import { startGame } from './game'

const canvas = document.getElementById('game') as HTMLCanvasElement
const root = document.getElementById('ui') as HTMLElement

startGame(canvas, root)
