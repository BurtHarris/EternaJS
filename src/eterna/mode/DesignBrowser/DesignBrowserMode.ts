import * as log from 'loglevel';
import MultiStyleText from 'pixi-multistyle-text';
import {
    Container, Graphics, Point, Sprite, Text
} from 'pixi.js';
import EPars from 'eterna/EPars';
import Eterna from 'eterna/Eterna';
import Feedback from 'eterna/Feedback';
import GameMode from 'eterna/mode/GameMode';
import Puzzle from 'eterna/puzzle/Puzzle';
import GamePanel from 'eterna/ui/GamePanel';
import Fonts from 'eterna/util/Fonts';
import SliderBar from 'eterna/ui/SliderBar';
import {
    ContainerObject, DisplayUtil, HAlign, VAlign, RepeatingTask, SerialTask, DelayTask, CallbackTask,
    MathUtil, Flashbang, SceneObject, AlphaTask, LocationTask, Easing, HLayoutContainer
} from 'flashbang';
import GameButton from 'eterna/ui/GameButton';
import Bitmaps from 'eterna/resources/Bitmaps';
import BitmapManager from 'eterna/resources/BitmapManager';
import HTMLTextObject from 'eterna/ui/HTMLTextObject';
import Solution from 'eterna/puzzle/Solution';
import SolutionManager from 'eterna/puzzle/SolutionManager';
import URLButton from 'eterna/ui/URLButton';
import int from 'eterna/util/int';
import VoteProcessor from './VoteProcessor';
import ViewSolutionDialog from './ViewSolutionDialog';
import SortOptionsDialog from './SortOptionsDialog';
import SortOptions, {SortOrder} from './SortOptions';
import SelectionBox from './SelectionBox';
import MarkerBoxView from './MarkerBoxView';
import GridLines from './GridLines';
import DotLine from './DotLine';
import DataCol from './DataCol';
import CustomizeColumnOrderDialog from './CustomizeColumnOrderDialog';

export enum DesignBrowserDataType {
    INT = 0,
    STRING = 1,
    NUMBER = 2,
}

export enum DesignCategory {
    ID = 'Id',
    TITLE = 'Title',
    DESIGNER = 'Designer',
    VOTES = 'Votes',
    MY_VOTES = 'My Votes',
    DESCRIPTION = 'Description',
    ROUND = 'Round',
    GC_PAIRS = 'GC Pairs',
    UA_PAIRS = 'UA Pairs',
    GU_PAIRS = 'GU Pairs',
    MELTING_POINT = 'Melting Point',
    FREE_ENERGY = 'Free Energy',
    SYNTHESIZED = 'Synthesized',
    SYNTHESIS_SCORE = 'Synthesis score',
    SEQUENCE = 'Sequence',
}

function AllCategories(): DesignCategory[] {
    return Object.values(DesignCategory);
}

export interface DesignBrowserFilter {
    category: DesignCategory;
    arg1?: string;
    arg2?: string;
}

export default class DesignBrowserMode extends GameMode {
    constructor(puzzle: Puzzle, novote = false, initialFilters: DesignBrowserFilter[] = null) {
        super();

        this._puzzle = puzzle;
        this._novote = novote;
        this._initialDataFilters = initialFilters;
        this._wholeRowWidth = 0;
        this._voteProcessor = new VoteProcessor();
    }

    public get puzzleID(): number { return this._puzzle.nodeID; }

    public get isOpaque(): boolean { return true; }

    protected setup(): void {
        super.setup();

        this._content.position = new Point(10, 86);
        this.uiLayer.addChild(this._content);

        this._votesPanel = new GamePanel();
        this.addObject(this._votesPanel, this._content);

        const WMARGIN = 22;
        const HMARGIN = 17;

        // the height of a line of text in the DataCol objects
        let lineHeight = Fonts.arial('', 14).computeLineHeight();

        this._votesText = new MultiStyleText('You have...', {
            default: {
                fontFamily: Fonts.ARIAL,
                fontSize: 12,
                fill: 0xffffff
            },
            bold: {
                fontStyle: 'bold',
                fill: 0xffcc00
            }
        });
        this._votesText.position = new Point(WMARGIN, HMARGIN);
        this._votesPanel.container.addChild(this._votesText);

        this._votesPanel.setSize(this._votesText.width + 2 * WMARGIN, this._votesText.height + 2 * HMARGIN);
        this._votesPanel.display.position = new Point(0, -this._votesPanel.height - 2);

        this._vSlider = new SliderBar(true);
        this._vSlider.setProgress(0);
        this._vSlider.scrollChanged.connect((scrollValue) => this.setScrollVertical(scrollValue));
        this.addObject(this._vSlider, this._content);

        this._hSlider = new SliderBar(false);
        this._hSlider.setProgress(0);
        this._hSlider.scrollChanged.connect((scrollValue) => this.setScrollHorizontal(scrollValue));
        this.addObject(this._hSlider, this._content);

        this._dataColParent = new ContainerObject();
        this.addObject(this._dataColParent, this._content);

        this._firstVisSolutionIdx = 0;

        this._divider1 = new DotLine(2, 0x788891);
        this._divider1.position = new Point(5, 34);
        this._content.addChild(this._divider1);

        this._divider2 = new DotLine(2, 0x788891);
        this._divider2.position = new Point(5, 82);
        this._content.addChild(this._divider2);

        this._gridLines = new GridLines(2, 0x4A5F73, 5 * lineHeight);
        this._gridLines.position = new Point(10, 168);
        this._content.addChild(this._gridLines);

        this._maskBox = new MaskBox();
        this._maskBox.position = new Point(7, 5);
        this._content.addChild(this._maskBox);

        this._dataColParent.display.mask = this._maskBox;

        this._markerBoxes = new MarkerBoxView(0xFF0000, lineHeight);
        this._markerBoxes.position = new Point(7, 88);
        this._content.addChild(this._markerBoxes);

        this._selectionBox = new SelectionBox(0xFFFFFF);
        this._selectionBox.position = new Point(7, 0);
        this._selectionBox.visible = false;
        this._content.addChild(this._selectionBox);

        this._dataColParent.pointerMove.connect(() => this.onMouseMove());
        this._dataColParent.pointerDown.connect(() => this.onMouseDown());

        this._categories = Eterna.settings.designBrowserColumnNames.value;
        if (this._categories == null) {
            this._categories = DesignBrowserMode.DEFAULT_COLUMNS.slice();
        }
        this._selectedSolutionIDs = Eterna.settings.designBrowserSelectedSolutionIDs.value;
        if (this._selectedSolutionIDs == null) {
            this._selectedSolutionIDs = [];
        }

        let sortableCategories = [
            DesignCategory.ID,
            DesignCategory.TITLE,
            DesignCategory.DESIGNER,
            DesignCategory.DESCRIPTION,
            DesignCategory.ROUND,
            DesignCategory.GC_PAIRS,
            DesignCategory.UA_PAIRS,
            DesignCategory.GU_PAIRS,
            DesignCategory.MELTING_POINT,
            DesignCategory.FREE_ENERGY,
            DesignCategory.SYNTHESIS_SCORE
        ];
        if (!this._novote) {
            sortableCategories.push(DesignCategory.VOTES);
            sortableCategories.push(DesignCategory.MY_VOTES);
        }

        this._sortOptions = new SortOptions(sortableCategories);
        this._sortOptions.sortChanged.connect(() => this.reorganize(true));

        this._toolbarLayout = new HLayoutContainer();
        this._content.addChild(this._toolbarLayout);

        this._letterColorButton = new GameButton()
            .up(Bitmaps.ImgColoring)
            .over(Bitmaps.ImgColoringOver)
            .down(Bitmaps.ImgColoringOver)
            .selected(Bitmaps.ImgColoringSelected)
            .tooltip('Color sequences based on base colors as in the game.');
        this._letterColorButton.toggled.value = true;
        this.addObject(this._letterColorButton, this._toolbarLayout);
        this._letterColorButton.clicked.connect(() => this.setSequenceLetterColor());

        this._expColorButton = new GameButton()
            .up(Bitmaps.ImgFlask)
            .over(Bitmaps.ImgFlaskOver)
            .down(Bitmaps.ImgFlaskOver)
            .selected(Bitmaps.ImgFlaskSelected)
            .tooltip('Color sequences based on experimental data.');
        this._expColorButton.toggled.value = false;
        this.addObject(this._expColorButton, this._toolbarLayout);
        this._expColorButton.clicked.connect(() => this.setSequenceExpColor());

        this._toolbarLayout.addHSpacer(20);

        let editSortBtn = new GameButton()
            .up(Bitmaps.ImgEditSortOptions)
            .over(Bitmaps.ImgEditSortOptionsOver)
            .down(Bitmaps.ImgEditSortOptionsHit)
            .tooltip('Editor sort options.');
        this.addObject(editSortBtn, this._toolbarLayout);
        editSortBtn.clicked.connect(() => this.showSortDialog());

        this._toolbarLayout.addHSpacer(5);

        this._customizeButton = new GameButton()
            .up(Bitmaps.ImgColumns)
            .over(Bitmaps.ImgColumnsOver)
            .down(Bitmaps.ImgColumnsHit)
            .tooltip('Select and reorder columns.');
        this.addObject(this._customizeButton, this._toolbarLayout);
        this._customizeButton.clicked.connect(() => this.showCustomizeColumnOrderDialog());

        this._toolbarLayout.addHSpacer(5);

        this._returnToGameButton = new GameButton()
            .up(Bitmaps.ImgReturn)
            .over(Bitmaps.ImgReturnOver)
            .down(Bitmaps.ImgReturnHit)
            .tooltip('Return to game.');
        this.addObject(this._returnToGameButton, this._toolbarLayout);
        this._returnToGameButton.clicked.connect(() => this.returnToGame());

        this._toolbarLayout.layout();

        this._homeButton = GameMode.createHomeButton();
        this._homeButton.hideWhenModeInactive();
        this.addObject(this._homeButton, this.uiLayer);

        let puzzleIcon = new Sprite(BitmapManager.getBitmap(Bitmaps.NovaPuzzleImg));
        puzzleIcon.position = new Point(11, 8);
        this.uiLayer.addChild(puzzleIcon);

        let puzzleTitle = new HTMLTextObject(this._puzzle.getName(true))
            .font(Fonts.ARIAL)
            .fontSize(14)
            .bold()
            .selectable(false)
            .color(0xffffff);
        puzzleTitle.hideWhenModeInactive();
        this.addObject(puzzleTitle, this.uiLayer);
        DisplayUtil.positionRelative(
            puzzleTitle.display, HAlign.LEFT, VAlign.CENTER,
            puzzleIcon, HAlign.RIGHT, VAlign.CENTER, 3, 0
        );

        // Refresh our data immediately, and then every 300 seconds
        this.refreshSolutions();

        this.addObject(new RepeatingTask(() => new SerialTask(
            new DelayTask(300),
            new CallbackTask(() => this.refreshSolutions())
        )));

        this.updateLayout();
    }

    public onResized(): void {
        super.onResized();
        this.updateLayout();
    }

    public onMouseWheelEvent(e: WheelEvent): void {
        if (!this.isDialogOrNotifShowing && e.deltaY !== 0 && this._filteredSolutions != null) {
            const progress = (this._firstVisSolutionIdx + (e.deltaY * 0.25)) / this._filteredSolutions.length;
            this._vSlider.setProgress(MathUtil.clamp(progress, 0, 1));
        } else {
            super.onMouseWheelEvent(e);
        }
    }

    private get contentWidth(): number {
        return Flashbang.stageWidth - 40;
    }

    private get contentHeight(): number {
        return Flashbang.stageHeight - 170;
    }

    private updateLayout(): void {
        this._hSlider.display.position = new Point(30, this.contentHeight + 3);
        this._hSlider.setSize(this.contentWidth - 60, 0);

        this._vSlider.display.position = new Point(this.contentWidth + 5, 50);
        this._vSlider.setSize(0, this.contentHeight - 70);

        this._divider1.length = this.contentWidth - 10;
        this._divider2.length = this.contentWidth - 10;
        this._gridLines.setSize(this.contentWidth - 10, this.contentHeight - this._gridLines.position.y);
        this._maskBox.setSize(this.contentWidth - 14, this.contentHeight - 10);
        this._markerBoxes.setSize(this.contentWidth - 14, this.contentHeight - 10);
        this._selectionBox.setSize(this.contentWidth - 14, 20);

        this._toolbarLayout.position = new Point(20, this.contentHeight + 25);

        if (this._dataCols != null) {
            for (let col of this._dataCols) {
                col.setSize(this.contentWidth, this.contentHeight);
            }
        }

        DisplayUtil.positionRelativeToStage(
            this._homeButton.display, HAlign.RIGHT, VAlign.TOP,
            HAlign.RIGHT, VAlign.TOP, 0, 5
        );
    }

    protected enter(): void {
        super.enter();
        this.refreshSolutions();
        const {existingPoseEditMode} = Eterna.app;
        this._returnToGameButton.display.visible = (
            existingPoseEditMode != null && existingPoseEditMode.puzzleID === this.puzzleID
        );
        Eterna.chat.pushHideChat();
    }

    protected exit(): void {
        Eterna.chat.popHideChat();
        super.exit();
    }

    private setSequenceLetterColor(): void {
        this._letterColorButton.toggled.value = true;
        this._expColorButton.toggled.value = false;

        for (let dataCol of this._dataCols) {
            if (dataCol.category === DesignCategory.SEQUENCE) {
                dataCol.showExp = false;
            }
        }
    }

    private setSequenceExpColor(): void {
        this._letterColorButton.toggled.value = false;
        this._expColorButton.toggled.value = true;

        for (let dataCol of this._dataCols) {
            if (dataCol.category === DesignCategory.SEQUENCE) {
                dataCol.showExp = true;
            }
        }
    }

    private async switchToPoseEditForSolution(solution: Solution): Promise<void> {
        this.pushUILock();

        try {
            await Eterna.app.switchToPoseEdit(
                this._puzzle, false, {initSolution: solution, solutions: this._filteredSolutions.slice()}
            );
        } catch (e) {
            log.error(e);
        } finally {
            this.popUILock();
        }
    }

    private switchToFeedbackViewForSolution(solution: Solution): void {
        this.pushUILock();

        Eterna.app.switchToFeedbackView(this._puzzle, solution)
            .then(() => this.popUILock())
            .catch((e) => {
                log.error(e);
                this.popUILock();
            });
    }

    private navigateToSolution(solution: Solution): void {
        this.closeCurDialog();
        window.open(`/node/${solution.nodeID}/edit`, 'soleditwindow');
    }

    private sortOnSolution(solution: Solution): void {
        this.closeCurDialog();
        this._sortOptions.addCriteria(DesignCategory.SEQUENCE, SortOrder.INCREASING, solution.sequence);
        this.showSortDialog();
    }

    private static createStatusText(text: string): SceneObject<Text> {
        let statusText = new SceneObject<Text>(Fonts.arial(text, 22).color(0xffffff).bold().build());
        statusText.addObject(new RepeatingTask(() => new SerialTask(
            new AlphaTask(0, 0.3),
            new AlphaTask(1, 0.3)
        )));
        return statusText;
    }

    private unpublish(solution: Solution): void {
        this.pushUILock();

        let statusText = DesignBrowserMode.createStatusText('Deleting...');
        this.addObject(statusText, this.notifLayer);
        DisplayUtil.positionRelativeToStage(statusText.display,
            HAlign.CENTER, VAlign.CENTER,
            HAlign.CENTER, VAlign.CENTER);

        const cleanup = () => {
            this.popUILock();
            statusText.destroySelf();
            this.closeCurDialog();
            this.updateDataColumns();
        };

        Eterna.client.deleteSolution(solution.nodeID)
            .then(() => SolutionManager.instance.getSolutionsForPuzzle(this._puzzle.nodeID))
            .then(cleanup)
            .catch((err) => {
                this.showNotification(`Delete failed: ${err}`);
                cleanup();
            });
    }

    private vote(solution: Solution): void {
        this.pushUILock();

        let statusText = DesignBrowserMode.createStatusText('Submitting...');
        this.addObject(statusText, this.notifLayer);
        DisplayUtil.positionRelativeToStage(statusText.display,
            HAlign.CENTER, VAlign.CENTER,
            HAlign.CENTER, VAlign.CENTER);

        const cleanup = () => {
            this.popUILock();
            statusText.destroySelf();
            this.closeCurDialog();
        };

        Eterna.client.toggleSolutionVote(solution.nodeID, this._puzzle.nodeID, solution.getProperty('My Votes'))
            .then((data) => {
                this._voteProcessor.processData(data['votes']);
                this.syncVotes();

                let cheevs: any = data['new_achievements'];
                if (cheevs != null) {
                    this._achievements.awardAchievements(cheevs).then(() => { /* ignore result */ });
                }
                cleanup();
            })
            .catch((err) => {
                this.showNotification(`Vote failed: ${err}`);
                cleanup();
            });
    }

    private onMouseDown(): void {
        if (Flashbang.app.isControlKeyDown || Flashbang.app.isMetaKeyDown) {
            this.mark();
            return;
        }

        if (this._filteredSolutions == null) {
            return;
        }

        const [index] = this._dataCols[0].getMouseIndex();
        if (index < 0) {
            return;
        }

        const solution = this.getSolutionAtIndex(index + this._firstVisSolutionIdx);
        if (solution != null) {
            this.showSolutionDetailsDialog(solution);
        }
    }

    private showSolutionDetailsDialog(solution: Solution): void {
        let dialog = this.showDialog(new ViewSolutionDialog(solution, this._puzzle, this._novote));

        dialog.playClicked.connect(() => this.switchToPoseEditForSolution(solution));
        dialog.seeResultClicked.connect(() => this.switchToFeedbackViewForSolution(solution));
        dialog.voteClicked.connect(() => this.vote(solution));
        dialog.sortClicked.connect(() => this.sortOnSolution(solution));
        dialog.editClicked.connect(() => this.navigateToSolution(solution));
        dialog.deleteClicked.connect(() => this.unpublish(solution));
    }

    private onMouseMove(): void {
        this._selectionBox.visible = false;

        if (this._dataCols == null || this._dialogRef.isLive || this._filteredSolutions == null) {
            return;
        }

        const [index, yOffset] = this._dataCols[0].getMouseIndex();
        if (index >= 0 && index < this._filteredSolutions.length) {
            this._selectionBox.visible = true;
            this._selectionBox.position = new Point(7, this._content.toLocal(Flashbang.globalMouse).y + yOffset);
        }
    }

    private mark(): void {
        if (this._dataCols == null) {
            this._markerBoxes.visible = false;
            return;
        }

        if (this.isDialogOrNotifShowing) {
            return;
        }

        let [index] = this._dataCols[0].getMouseIndex();
        if (index < 0) {
            return;
        }

        index += this._firstVisSolutionIdx;

        let solution = this.getSolutionAtIndex(index);
        if (solution == null) {
            return;
        }

        let solutionID = solution.nodeID;
        this._markerBoxes.visible = true;

        if (!this._markerBoxes.isSelected(index)) {
            this._markerBoxes.addMarker(index);
            this._selectedSolutionIDs.push(solutionID);
        } else {
            this._markerBoxes.removeMarker(index);
            let removeIdx = this._selectedSolutionIDs.indexOf(solutionID);
            if (removeIdx >= 0) {
                this._selectedSolutionIDs.splice(removeIdx, 1);
            }
        }

        this._markerBoxes.updateView(this._firstVisSolutionIdx);

        Eterna.settings.designBrowserSelectedSolutionIDs.value = this._selectedSolutionIDs.slice();
    }

    private showSortDialog(): void {
        this.showDialog(new SortOptionsDialog(this._sortOptions));
    }

    private showCustomizeColumnOrderDialog(): void {
        let disabledCategories = new Set<DesignCategory>();
        if (this._novote) {
            disabledCategories.add(DesignCategory.VOTES);
            disabledCategories.add(DesignCategory.MY_VOTES);
        }

        let dialog = this.showDialog(
            new CustomizeColumnOrderDialog(AllCategories(), this._categories, disabledCategories)
        );
        dialog.columnsReorganized.connect((columnNames) => {
            this._categories = columnNames;
            Eterna.settings.designBrowserColumnNames.value = columnNames;
            this.rebuildDataColumns(this._initialDataFilters);
            this.reorganize(true);
        });
    }

    private updateSortOption(category: DesignCategory, sortOrder: SortOrder, sortArgs: any[] = null): void {
        if (sortOrder !== SortOrder.NONE) {
            this._sortOptions.addCriteria(category, sortOrder, sortArgs);
        } else {
            this._sortOptions.removeCriteria(category);
        }
    }

    private reorganize(sort: boolean): void {
        if (sort) {
            this._allSolutions.sort((a, b) => this._sortOptions.compareSolutions(a, b));

            for (let dataCol of this._dataCols) {
                dataCol.setSortState(this._sortOptions.getSortOrder(dataCol.category));
            }
        }

        let solutions: Solution[] = [];
        for (let sol of this._allSolutions) {
            let shouldAdd = true;
            for (let dataCol of this._dataCols) {
                if (!dataCol.shouldDisplay(sol)) {
                    shouldAdd = false;
                    break;
                }
            }

            if (shouldAdd) {
                solutions.push(sol);
            }
        }

        this._filteredSolutions = solutions;
        this.setData(solutions, false, false);
        this.setScrollVertical(-1);
    }

    private setScrollHorizontal(progress: number): void {
        this._dataColParent.display.x = (this._wholeRowWidth > this.contentWidth)
            ? (this.contentWidth - this._wholeRowWidth) * progress
            : 0;
    }

    private setScrollVertical(progress: number): void {
        this._firstVisSolutionIdx = 0;
        if (this._dataCols == null) {
            return;
        }

        if (progress < 0) {
            progress = this._vSlider.getProgress();
        }

        if (this._filteredSolutions != null) {
            this._firstVisSolutionIdx = int(this._filteredSolutions.length * progress);
        }

        for (let dataCol of this._dataCols) {
            dataCol.scrollProgress = this._firstVisSolutionIdx;
        }

        this._markerBoxes.updateView(this._firstVisSolutionIdx);
    }

    private refreshSolutions(): void {
        SolutionManager.instance.getSolutionsForPuzzle(this._puzzle.nodeID)
            .then(() => this.updateDataColumns());
    }

    private updateVotes(): void {
        this._voteProcessor.updateVotes(this._puzzle.nodeID, this._puzzle.round)
            .then(() => this.syncVotes());
    }

    private syncVotes(): void {
        let {votesLeft} = this._voteProcessor;
        let {round} = this._puzzle;
        let available: number = this._puzzle.numSubmissions;
        let mySolutionTitles: string[] = SolutionManager.instance.getMyCurrentSolutionTitles(round);

        if (!this._novote) {
            this._votesText.text = `You have <bold>${votesLeft}</bold> votes and `
                + `<bold>${available - mySolutionTitles.length}</bold> solution slots left.`;
        } else {
            this._votesText.text = 'This puzzle has been cleared.';
        }

        const WMARGIN = 22;
        const HMARGIN = 17;
        this._votesPanel.setSize(this._votesText.width + 2 * WMARGIN, this._votesText.height + 2 * HMARGIN);

        this.reorganize(true);
    }

    private rebuildDataColumns(filters: DesignBrowserFilter[] = null): void {
        const FONT = 'Arial';
        const FONT_SIZE = 14;

        if (this._dataCols != null) {
            for (let dataCol of this._dataCols) {
                dataCol.destroySelf();
            }
        }

        this._dataCols = [];
        for (let category of this._categories) {
            if (this._novote && (category === DesignCategory.VOTES || category === DesignCategory.MY_VOTES)) {
                continue;
            }

            let column: DataCol;
            switch (category) {
                case DesignCategory.TITLE:
                    column = new DataCol(DesignBrowserDataType.STRING, category, 250, FONT, FONT_SIZE, true);
                    break;
                case DesignCategory.DESIGNER:
                    column = new DataCol(DesignBrowserDataType.STRING, category, 220, FONT, FONT_SIZE, true);
                    break;
                case DesignCategory.DESCRIPTION:
                    column = new DataCol(DesignBrowserDataType.STRING, category, 300, FONT, FONT_SIZE, true);
                    break;
                case DesignCategory.SEQUENCE:
                    column = new DataCol(DesignBrowserDataType.STRING, category, 0, FONT, FONT_SIZE, false);
                    break;
                case DesignCategory.SYNTHESIZED:
                    column = new DataCol(DesignBrowserDataType.STRING, category, 100, FONT, FONT_SIZE, true);
                    break;
                case DesignCategory.VOTES:
                    column = new DataCol(DesignBrowserDataType.NUMBER, category, 100, FONT, FONT_SIZE, true);
                    break;
                case DesignCategory.SYNTHESIS_SCORE:
                    column = new DataCol(DesignBrowserDataType.NUMBER, category, 170, FONT, FONT_SIZE, true);
                    break;
                default:
                    column = new DataCol(DesignBrowserDataType.NUMBER, category, 125, FONT, FONT_SIZE, true);
                    break;
            }

            column.setSize(this.contentWidth, this.contentHeight);
            column.filtersChanged.connect(() => this.reorganize(false));
            column.sortOrderChanged.connect((sortOrder) => this.updateSortOption(column.category, sortOrder));

            this._dataCols.push(column);
            this._dataColParent.addObject(column, this._dataColParent.container);

            if (filters != null) {
                for (let filter of filters) {
                    if (filter.category === category) {
                        column.setFilter(filter.arg1, filter.arg2);
                        break;
                    }
                }
            }
        }

        this.layoutColumns(false);
    }

    private setData(solutions: Solution[], animate: boolean, initializeOnly: boolean = false): void {
        if (this._dataCols == null) {
            this.rebuildDataColumns(this._initialDataFilters);
        }

        if (initializeOnly) {
            return;
        }

        let puz: Puzzle = this._puzzle;

        for (let dataCol of this._dataCols) {
            let dataArray: any[] = [];

            let {category} = dataCol;
            let feedbacks: Feedback[] = [];

            for (let solution of solutions) {
                feedbacks.push(solution.expFeedback);
            }

            for (let ii = 0; ii < solutions.length; ii++) {
                // single row of raw data
                let singleLineRawData: Solution = solutions[ii];

                if (category === DesignCategory.SEQUENCE) {
                    dataArray.push(singleLineRawData.sequence);
                    if (ii === 0) {
                        dataCol.setWidth(singleLineRawData.sequence.length * 16);
                        dataCol.drawGridText();
                    }
                } else if (category === DesignCategory.DESCRIPTION) {
                    let des = singleLineRawData.getProperty('Description');
                    if (des.length < 45) {
                        dataArray.push(des);
                    } else {
                        dataArray.push(`${des.substr(0, 40)}...`);
                    }
                } else if (category === DesignCategory.TITLE) {
                    let des = singleLineRawData.getProperty('Title');
                    if (des.length < 30) {
                        dataArray.push(des);
                    } else {
                        dataArray.push(`${des.substr(0, 25)}...`);
                    }
                } else {
                    let rawdata: any = singleLineRawData.getProperty(category);
                    dataArray.push(rawdata);
                }
            }

            if (category === DesignCategory.SEQUENCE || category === DesignCategory.SYNTHESIS_SCORE) {
                dataCol.expFeedback = feedbacks;
            }
            dataCol.setPairs(EPars.parenthesisToPairs(puz.getSecstruct()));

            // Setting and Displaying all raw data for each column
            dataCol.setDataAndDisplay(dataArray);
        }

        this.refreshMarkingBoxes();
        this.layoutColumns(animate);
    }

    private getSolutionIndex(solutionID: number): number {
        for (let ii = 0; ii < this._filteredSolutions.length; ii++) {
            if (this._filteredSolutions[ii].nodeID === solutionID) {
                return ii;
            }
        }
        return -1;
    }

    private getSolutionAtIndex(idx: number): Solution {
        return idx >= 0 && idx < this._filteredSolutions.length ? this._filteredSolutions[idx] : null;
    }

    private layoutColumns(animate: boolean): void {
        this._wholeRowWidth = 0;

        for (let ii = 0; ii < this._dataCols.length; ii++) {
            let col: DataCol = this._dataCols[ii];
            if (animate) {
                col.replaceNamedObject('AnimateLocation',
                    new LocationTask(this._wholeRowWidth, 0, 0.5, Easing.easeOut));
            } else {
                col.display.position = new Point(this._wholeRowWidth, 0);
            }

            this._wholeRowWidth += col.width;

            if (ii % 2 === 0) {
                col.bgColor = 0x012034;
            } else {
                col.bgColor = 0x1A2F43;
            }
        }
    }

    private refreshMarkingBoxes(): void {
        this._markerBoxes.clear();
        for (let solutionID of this._selectedSolutionIDs) {
            let index = this.getSolutionIndex(solutionID);
            if (index >= 0 && index < this._filteredSolutions.length) {
                this._markerBoxes.addMarker(index);
            }
        }
        this._markerBoxes.updateView(this._firstVisSolutionIdx);
    }

    private updateDataColumns(): void {
        let {solutions} = SolutionManager.instance;

        this.setData(solutions, false, true);

        this._allSolutions = solutions;
        this.updateVotes();
        this.setScrollVertical(-1);

        this.updateLayout();
    }

    private returnToGame(): void {
        const {existingPoseEditMode} = Eterna.app;
        if (existingPoseEditMode != null && existingPoseEditMode.puzzleID === this.puzzleID) {
            this.pushUILock();
            Eterna.app.switchToPoseEdit(this._puzzle, true)
                .then(() => this.popUILock())
                .catch((e) => {
                    log.error(e);
                    this.popUILock();
                });
        }
    }

    private readonly _puzzle: Puzzle;
    private readonly _novote: boolean;
    private readonly _initialDataFilters: DesignBrowserFilter[];
    private readonly _content = new Container();

    private _divider1: DotLine;
    private _divider2: DotLine;
    private _gridLines: GridLines;
    private _maskBox: MaskBox;

    private _selectedSolutionIDs: number[];
    private _vSlider: SliderBar;
    private _hSlider: SliderBar;
    private _dataColParent: ContainerObject;
    private _firstVisSolutionIdx: number;
    private _wholeRowWidth: number;
    private _dataCols: DataCol[];
    private _allSolutions: Solution[];
    private _filteredSolutions: Solution[];

    private _homeButton: URLButton;
    private _sortOptions: SortOptions;
    private _toolbarLayout: HLayoutContainer;
    private _customizeButton: GameButton;
    private _returnToGameButton: GameButton;
    private _letterColorButton: GameButton;
    private _expColorButton: GameButton;
    private _votesText: MultiStyleText;
    private _votesPanel: GamePanel;
    private _selectionBox: SelectionBox;
    private _markerBoxes: MarkerBoxView;
    private _categories: DesignCategory[];
    private _voteProcessor: VoteProcessor;

    private static readonly DEFAULT_COLUMNS: DesignCategory[] = [
        DesignCategory.ID,
        DesignCategory.TITLE,
        DesignCategory.DESIGNER,
        DesignCategory.VOTES,
        DesignCategory.MY_VOTES,
        DesignCategory.DESCRIPTION,
        DesignCategory.ROUND,
        DesignCategory.GC_PAIRS,
        DesignCategory.UA_PAIRS,
        DesignCategory.GU_PAIRS,
        DesignCategory.MELTING_POINT,
        DesignCategory.FREE_ENERGY,
        DesignCategory.SYNTHESIZED,
        DesignCategory.SYNTHESIS_SCORE,
        DesignCategory.SEQUENCE
    ];
}


class MaskBox extends Graphics {
    public setSize(width: number, height: number): void {
        if (this._width === width && this._height === height) {
            return;
        }

        this._width = width;
        this._height = height;

        this.clear();
        this.beginFill(0x18202b, 0.9);
        this.drawRoundedRect(0, 0, this._width, this._height, 20);
        this.endFill();
    }

    private _width: number = 0;
    private _height: number = 0;
}
