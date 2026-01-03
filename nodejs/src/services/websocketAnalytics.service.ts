export class WebsocketAnalytics {
	public totalData: number;
	private intervalId?: ReturnType<typeof setInterval>;
	private intervalData: number;
	private intervalFrame: number;
	private intervalTime: number;

	public constructor(
		initialData: number = 0,
		initFrame: number = 0,
		intervalTime: number = 10_000
	) {
		this.totalData = initialData;
		this.intervalData = initialData;
		this.intervalFrame = initFrame;
		this.intervalTime = intervalTime;
	}

	public startAnalytics() {
		this.intervalId = setInterval(() => {
			console.log({
				frame: this.intervalFrame / 10 + 'FPS',
				size:
					parseFloat(this.intervalData / 1024 / 1024 + '').toFixed(
						2
					) + 'Mb',
				speedAvg:
					parseFloat(this.intervalData / 10 / 1024 + '').toFixed(2) +
					'Kbps',
			});

			this.intervalData = this.intervalFrame = 0;
		}, this.intervalTime);
	}

	public stopAnalytics() {
		clearInterval(this.intervalId);
		this.intervalId = undefined;
	}

	public transferData(data: number, frame: number) {
		if (!this.intervalId)
			return console.log('Please start analysis before transfer data!');

		this.totalData += data;
		this.intervalData += data;
		this.intervalFrame += frame;
	}

	public clearIntervalData() {
		this.intervalData = 0;
		this.intervalFrame = 0;
	}

	private clearData() {
		this.totalData = 0;
		this.clearIntervalData();
	}
}

export const websocketAnalytics = new WebsocketAnalytics(0, 0, 10_000);
websocketAnalytics.startAnalytics();
