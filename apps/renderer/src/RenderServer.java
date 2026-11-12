import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.font.FontProvider;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Renderizador HTML→PDF com o mesmo motor do MyKids Printer 1.3.5 (iText html2pdf 2.1.3 / iText 7.1.6),
 * reproduzindo PDFDocument.newPDF: página = dimensão * 3 pt e margens do Document (0, 0, 0, -5).
 *
 * Protocolo (stdin/stdout, uma linha por pedido, campos separados por TAB):
 *   pedido:   id  larguraPt  alturaPt  arquivoHtml  arquivoPdfSaida
 *   resposta: id  OK   |   id  ERR  mensagem
 * Argumento opcional: pasta com as fontes Golos (usadas quando o modelo contém "useGolos: true").
 */
public class RenderServer {
    public static void main(String[] args) throws Exception {
        String fontsDir = args.length > 0 ? args[0] : null;
        PrintStream out = new PrintStream(System.out, true, "UTF-8");
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        out.println("READY");
        String line;
        while ((line = in.readLine()) != null) {
            String[] f = line.split("\t");
            if (f.length < 5) continue;
            String id = f[0];
            try {
                render(Float.parseFloat(f[1]), Float.parseFloat(f[2]), f[3], f[4], fontsDir);
                out.println(id + "\tOK");
            } catch (Throwable e) {
                out.println(id + "\tERR\t" + String.valueOf(e.getMessage()).replace('\n', ' ').replace('\t', ' '));
            }
        }
    }

    static void render(float w, float h, String htmlFile, String pdfFile, String fontsDir) throws Exception {
        String html = new String(Files.readAllBytes(Paths.get(htmlFile)), StandardCharsets.UTF_8);
        try (FileOutputStream fos = new FileOutputStream(pdfFile)) {
            PdfDocument pdf = new PdfDocument(new PdfWriter(fos));
            Document document = new Document(pdf);
            document.setMargins(0.0F, 0.0F, 0.0F, -5.0F);
            pdf.setDefaultPageSize(new PageSize(w, h));
            ConverterProperties props = new ConverterProperties();
            if (fontsDir != null && html.contains("useGolos: true")) {
                FontProvider fp = new FontProvider();
                for (String name : new String[]{"Golos.ttf", "Golos-Bold.ttf", "Golos-Semibold.ttf", "Golos-Medium.ttf"}) {
                    File font = new File(fontsDir, name);
                    if (font.exists()) fp.addFont(font.getAbsolutePath());
                }
                props.setFontProvider(fp);
            }
            HtmlConverter.convertToPdf(html, document.getPdfDocument(), props);
        }
    }
}
