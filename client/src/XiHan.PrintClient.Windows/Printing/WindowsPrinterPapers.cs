// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

using XiHan.PrintClient.Core.Printing;
using XiHan.PrintClient.Core.Protocol;

namespace XiHan.PrintClient.Windows.Printing;

/// <summary>
/// 一台打印机的纸张能力：纸张来自 DeviceCapabilities；试探纸张时照渲染引擎的写法，在驱动的缺省 DEVMODE 上设方向与纸张宽高，
/// 交给 DocumentProperties 合并，读驱动留下的纸张。只读，不改打印机的设置
/// </summary>
internal sealed unsafe class WindowsPrinterPapers : IPrinterPapers
{
    private readonly Winspool.PrinterHandle _handle;
    private readonly string _name;
    private readonly byte[]? _defaults;

    private WindowsPrinterPapers(Winspool.PrinterHandle handle, string name, IReadOnlyList<PaperInfo> papers)
    {
        _handle = handle;
        _name = name;
        Papers = papers;
        _defaults = Defaults(handle, name);
    }

    /// <inheritdoc />
    public IReadOnlyList<PaperInfo> Papers { get; }

    /// <summary>
    /// 打开打印机；打不开时为 null
    /// </summary>
    public static WindowsPrinterPapers? Open(string name, IReadOnlyList<PaperInfo> papers)
    {
        if (!Winspool.OpenPrinter(name, out var handle, null))
        {
            handle.Dispose();
            return null;
        }
        return new WindowsPrinterPapers(handle, name, papers);
    }

    /// <inheritdoc />
    public PaperFeed? Resolve(PaperFeed request)
    {
        if (_defaults is null)
            return null;
        var input = (byte[])_defaults.Clone();
        var output = new byte[_defaults.Length];
        fixed (byte* source = input)
        fixed (byte* merged = output)
        {
            var mode = (Winspool.DevModeHead*)source;
            mode->Fields |= Winspool.DmFieldOrientation | Winspool.DmFieldPaperWidth | Winspool.DmFieldPaperLength;
            mode->Orientation = request.Landscape ? Winspool.DmOrientLandscape : Winspool.DmOrientPortrait;
            mode->PaperWidth = (short)Math.Round(request.WidthMm * 10);
            mode->PaperLength = (short)Math.Round(request.HeightMm * 10);
            if (Winspool.DocumentProperties(0, _handle, _name, merged, source, Winspool.DmInBuffer | Winspool.DmOutBuffer) < 0)
                return null;
            var result = (Winspool.DevModeHead*)merged;
            return ResolvedOf(result->Fields, result->Orientation, result->PaperSize, result->PaperWidth, result->PaperLength, Papers);
        }
    }

    /// <inheritdoc />
    public void Dispose() => _handle.Dispose();

    /// <summary>
    /// 由合并后的 DEVMODE 得出驱动留下的纸张：标了宽高的按宽高；否则按纸张号查驱动报的纸张；都没有时按填着的宽高；读不出时为 null
    /// </summary>
    internal static PaperFeed? ResolvedOf(uint fields, short orientation, short paperSize, short paperWidth, short paperLength, IReadOnlyList<PaperInfo> papers)
    {
        var landscape = (fields & Winspool.DmFieldOrientation) != 0 && orientation == Winspool.DmOrientLandscape;
        var sized = paperWidth > 0 && paperLength > 0;
        const uint SizeFields = Winspool.DmFieldPaperWidth | Winspool.DmFieldPaperLength;
        if ((fields & SizeFields) == SizeFields && sized)
            return new PaperFeed(paperWidth / 10.0, paperLength / 10.0, landscape);
        if ((fields & Winspool.DmFieldPaperSize) != 0 && paperSize > 0 && paperSize != Winspool.DmPaperUser && papers.FirstOrDefault(paper => paper.Id == paperSize) is { } known)
            return new PaperFeed(known.WidthMm, known.HeightMm, landscape);
        return sized ? new PaperFeed(paperWidth / 10.0, paperLength / 10.0, landscape) : null;
    }

    /// <summary>
    /// 驱动的缺省 DEVMODE；缓冲按驱动要的两倍分配，有的驱动报的大小不够放下驱动私有部分
    /// </summary>
    private static byte[]? Defaults(Winspool.PrinterHandle handle, string name)
    {
        var size = Winspool.DocumentProperties(0, handle, name, null, null, 0);
        if (size < sizeof(Winspool.DevModeHead))
            return null;
        var buffer = new byte[size * 2];
        fixed (byte* output = buffer)
            return Winspool.DocumentProperties(0, handle, name, output, null, Winspool.DmOutBuffer) < 0 ? null : buffer;
    }
}
